using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Data.SqlClient;
using MACRO_WMS.Models;
using SAPbobsCOM;
using MACRO_WMS.SAP;
using System.Runtime.InteropServices;
using Azure.Core;
using static Microsoft.EntityFrameworkCore.DbLoggerCategory;
using Microsoft.Extensions.Logging;
using System.Text.Json;
using static Microsoft.EntityFrameworkCore.DbLoggerCategory.Database;
using System.Drawing;

/* [입고처리]
 * 샘플
{
  "bizSeq": 1,
  "APIKey": "emdc",
  "reqList": [
    {
      "ifKey": "IW202410250002",
      "inwhTypeCd": "IW91",
      "centerSeq": 3,
      "inwhTypeDtlCd": "I-100",
      "wmsReqNo": "IW202410250002",
      "erpReqNo": "IW202410250002",
      "procYmd": "20241025",
      "procHms": "142746",
      "procUserId": "kimhj",
      "prodList": [
        {
          "erpLineNo": "123",
          "exQty": 100,
          "ifIdx": "1",
          "ifProdId": "11011-365",
          "expYmd": "20250131",
          "erpBatchNo": "11011-365@250131",
          "lotNo": "2410"
        }
      ]
    }
  ]
}
*/

namespace MACRO_WMS.Controllers
{
    [ApiController]
    [Route("[controller]")]

    public class CBP002Controller : ControllerBase
    {
        public class ApplicationDbContext : DbContext
        {
            public ApplicationDbContext(DbContextOptions<ApplicationDbContext> options) : base(options) { }

        }

        private readonly IConfiguration _configuration;
        private readonly ILogger<CBP002Controller> _logger;

        Dictionary<string, double> itemQuantities = new Dictionary<string, double>();

        bool isNewLine = false;

        // SAP 관련 기본 변수
        private readonly DIAPI _sapDIAPI;
        private int DIresult;

        //사용자변수
        private string oDocDate = "";

        public CBP002Controller(ILogger<CBP002Controller> logger, IConfiguration configuration, DIAPI sapDIAPI)
        {
            _logger = logger;
            _configuration = configuration;
            _sapDIAPI = sapDIAPI;
        }

        /// <summary>
        /// 입고처리
        /// </summary>
        [HttpPost(Name = "CBP002")]
        public IActionResult GetItem([FromBody] CBP002 jCBP002)
        {
            _logger.LogWarning(jCBP002.ToString());

            // 객체를 JSON 문자열로 변환
            string jsonString = JsonSerializer.Serialize(jCBP002);

            _logger.LogWarning(jsonString);

            List<cResult> cResult = new List<cResult>();

            string connectionString = _configuration.GetConnectionString("DefaultConnection");

            //SAP DI Connect
            Company MACRO_company = _sapDIAPI.Get_MACRO_Company();
            Company SJ_company = _sapDIAPI.Get_SJ_Company();
            Documents oOPDN = null;
            Documents oOIGN = null;
            SqlCommand command;
            SqlDataReader reader;
            SAP.SAP sDB = new SAP.SAP();

            int i = 0;
            int j = 0;
            int chk = 0;
            int QTYSUM = 0;
            string ReIfKey = "";
            string ReProcBundleNo = "";

            List<ResultListItem> ResultList = new List<ResultListItem>();

            using (SqlConnection connection = new SqlConnection(connectionString))
            {   
                //DB 연결
                connection.Open();

                //API KEY 체크(최소한의 보안)
                if (jCBP002.APIKEY != "emdc")
                {
                    ResultList.Add(new ResultListItem
                    {
                        IfKey = "",
                        ProcBundleNo = "",
                        Result = "E",
                        Message = "API KEY Error"
                    });

                    //결과값 전달
                    var API_result = new cResult
                    {
                        HttpResult = "S", // S:성공, E:실패
                        HttpMessage = "Success",
                        ResultList = ResultList
                    };

                    return Ok(API_result);
                    //throw new Exception("API KEY Error");
                }

                //SQL 쿼리문 작성부분
                foreach (var jCBP002H in jCBP002.ReqList)
                {
                    try
                    {
                        ReIfKey = jCBP002H.IfKey;
                        ReProcBundleNo = jCBP002H.ProcBundleNo;

                        if (jCBP002.ReqList[i].InwhTypeCd == "IW01") //IW01 입고PO IW91 기타입고
                        {
                            if (jCBP002.BizSeq == 1)
                            {
                                oOPDN = (Documents)MACRO_company.GetBusinessObject(BoObjectTypes.oPurchaseDeliveryNotes);
                            }
                            else
                            {
                                oOPDN = (Documents)SJ_company.GetBusinessObject(BoObjectTypes.oPurchaseDeliveryNotes);
                            }

                            //헤더
                            string query = "SELECT CardCode FROM " + sDB.SAPDB(jCBP002.BizSeq.ToString()) + "..OPOR WHERE DocEntry = '" + jCBP002.ReqList[i].ErpReqNo + "'";
                            _logger.LogWarning(query);

                            //쿼리 실행
                            command = new SqlCommand(query, connection);
                            reader = command.ExecuteReader();
                            reader.Read();

                            //헤더
                            oOPDN.CardCode = reader.GetString(0); //거래처코드
                            oOPDN.DocDate = DateTime.ParseExact(jCBP002H.ProcYmd, "yyyyMMdd", null); //전기일
                            oOPDN.DocDueDate = DateTime.ParseExact(jCBP002H.ProcYmd, "yyyyMMdd", null); //만기일
                            oOPDN.TaxDate = DateTime.ParseExact(jCBP002H.ProcYmd, "yyyyMMdd", null); //증빙일
                            oOPDN.BPL_IDAssignedToInvoice = 1; //사업장
                            oOPDN.DocObjectCode = BoObjectTypes.oPurchaseDeliveryNotes;//입고PO
                            oOPDN.DocType = BoDocumentTypes.dDocument_Items;//품목(품목/서비스)
                            //oOPDN.Comments = ""; //비고
                            oOPDN.UserFields.Fields.Item("U_WMSDOCNUM").Value = jCBP002H.WmsReqNo;
                            oOPDN.UserFields.Fields.Item("U_WMSNUM").Value = jCBP002H.ProcBundleNo;
                            reader.Close();

                            //본문
                            foreach (var jCBP002L in jCBP002.ReqList[i].ProdList)
                            {
                                if ((jCBP002L.ErpLineNo) != chk)
                                {
                                    if (j != 0) { oOPDN.Lines.Add(); }
                                    QTYSUM = 0;
                                }

                                //라인
                                oOPDN.Lines.BaseType = 22; //원천문서 타입
                                oOPDN.Lines.BaseEntry = int.Parse(jCBP002.ReqList[i].ErpReqNo); //원천문서
                                oOPDN.Lines.BaseLine = (jCBP002L.ErpLineNo); //원천라인

                                //string query1 = "SELECT LineTotal FROM POR1 WHERE DocEntry = '" + jCBP002.ReqList[i].ErpReqNo + "' AND LineNum = '" + jCBP002L.ErpLineNo + "'"; //241203 test
                                string query1 = "SELECT (CASE WHEN LineTotal > 0 AND UOMCODE <> 'EA' THEN LineTotal / InvQty ELSE Price END), LineTotal FROM " + sDB.SAPDB(jCBP002.BizSeq.ToString()) + "..POR1 WHERE DocEntry = '" + jCBP002.ReqList[i].ErpReqNo + "' AND LineNum = '" + jCBP002L.ErpLineNo + "'"; //241203 test
                               
                                //_logger.LogWarning(query1);

                                //쿼리 실행
                                command = new SqlCommand(query1, connection);
                                reader = command.ExecuteReader();
                                reader.Read();

                                oOPDN.Lines.UnitPrice = (double)reader.GetDecimal(0); //단가
                                //oOPDN.Lines.LineTotal = (double)reader.GetDecimal(1); //총계
                                
                                reader.Close();

                                //oOPDN.Lines.LineNum = jCBP002L.ErpLineNo;
                                oOPDN.Lines.ItemCode = jCBP002L.IfProdId; //품목코드
                                //QTY수량 누적
                                QTYSUM = QTYSUM + jCBP002L.ExQty;
                                oOPDN.Lines.Quantity = QTYSUM; //수량
                                oOPDN.Lines.UoMEntry = 1; //수량(EA : UOM)

                                //배치
                                oOPDN.Lines.BatchNumbers.ExpiryDate = DateTime.ParseExact(jCBP002L.ExpYmd, "yyyyMMdd", null); //유통기한
                                oOPDN.Lines.BatchNumbers.BatchNumber = jCBP002L.ErpBatchNo; //배치번호 jCBP002s.oITEMCODE + '@' + jCBP002s.oEXTDATE;
                                oOPDN.Lines.BatchNumbers.Quantity = jCBP002L.ExQty; //수량(EA)
                                oOPDN.Lines.BatchNumbers.Add();

                                chk = (jCBP002L.ErpLineNo);

                                j++;
                            }

                            //마지막행 문서 추가
                            DIresult = oOPDN.Add();

                            j = 0;
                            QTYSUM = 0;
                            chk = 0;

                            //오브젝트 초기화
                            if (oOPDN != null)
                            {
                                Marshal.ReleaseComObject(oOPDN);
                                oOPDN = null;
                            }

                            //DI 문서 오류 처리
                            if (DIresult != 0)
                            {
                                if (jCBP002.BizSeq == 1)
                                {
                                    ResultList.Add(new ResultListItem
                                    {
                                        IfKey = jCBP002.ReqList[i].IfKey,
                                        ProcBundleNo = jCBP002.ReqList[i].ProcBundleNo,
                                        Result = "E",
                                        Message = $"DI Error: ${MACRO_company.GetLastErrorCode()} - ${MACRO_company.GetLastErrorDescription()}"
                                    });
                                    //throw new Exception($"DI Error: ${MACRO_company.GetLastErrorCode()} - ${MACRO_company.GetLastErrorDescription()}");
                                }
                                else
                                {
                                    ResultList.Add(new ResultListItem
                                    {
                                        IfKey = jCBP002.ReqList[i].IfKey,
                                        ProcBundleNo = jCBP002.ReqList[i].ProcBundleNo,
                                        Result = "E",
                                        Message = $"DI Error: ${SJ_company.GetLastErrorCode()} - ${SJ_company.GetLastErrorDescription()}"
                                    });
                                    //throw new Exception($"DI Error: ${SJ_company.GetLastErrorCode()} - ${SJ_company.GetLastErrorDescription()}");
                                }
                            }
                            else
                            {
                                ResultList.Add(new ResultListItem
                                {
                                    IfKey = jCBP002.ReqList[i].IfKey,
                                    ProcBundleNo = jCBP002.ReqList[i].ProcBundleNo,
                                    Result = "S",
                                    Message = "처리 완료"
                                });
                            }
                            i++;
                        }
                        else //기타입고
                        {
                            if (jCBP002.BizSeq == 1)
                            {
                                oOIGN = (Documents)MACRO_company.GetBusinessObject(BoObjectTypes.oInventoryGenEntry);
                            }
                            else
                            {
                                oOIGN = (Documents)SJ_company.GetBusinessObject(BoObjectTypes.oInventoryGenEntry);
                            }

                            //헤더
                            oOIGN.DocDate = DateTime.ParseExact(jCBP002H.ProcYmd, "yyyyMMdd", null);
                            oOIGN.DocDueDate = DateTime.ParseExact(jCBP002H.ProcYmd, "yyyyMMdd", null);
                            oOIGN.TaxDate = DateTime.ParseExact(jCBP002H.ProcYmd, "yyyyMMdd", null);

                            if (jCBP002.ReqList[i].InwhTypeDtlCd == "I-201") //소분입고일때만 가격리스트(국내매입단가:부가세별도)
                            {
                                oOIGN.GroupNumber = 30;
                            }
                            oOIGN.Comments = jCBP002H.Note;
                            oOIGN.UserFields.Fields.Item("U_WMSDOCNUM").Value = jCBP002H.WmsReqNo;
                            oOIGN.UserFields.Fields.Item("U_WMSNUM").Value = jCBP002H.ProcBundleNo;

                            //본문
                            foreach (var jCBP002L in jCBP002.ReqList[i].ProdList)
                            {
                                if ((jCBP002L.ErpLineNo) != chk)
                                {
                                    if (j != 0)
                                    {
                                        oOIGN.Lines.Add();
                                        QTYSUM = 0;
                                    }
                                }

                                //기타입출고 계정 조회
                                string query = " SELECT ZSM108L.U_AcctCode,OITM.AvgPrice ";
                                query = query + " From " + sDB.SAPDB(jCBP002.BizSeq.ToString()) + "..[@ZSM108H] ZSM108H";
                                query = query + " LEFT JOIN " + sDB.SAPDB(jCBP002.BizSeq.ToString()) + "..[@ZSM108L] ZSM108L ON ZSM108H.Code = ZSM108L.Code";
                                query = query + " LEFT JOIN " + sDB.SAPDB(jCBP002.BizSeq.ToString()) + "..[OITB] OITB ON OITB.ItmsGrpCod = ZSM108L.U_ItemGCod";
                                query = query + " LEFT JOIN " + sDB.SAPDB(jCBP002.BizSeq.ToString()) + "..[OITM] OITM ON OITM.ItemCode = '" + jCBP002L.IfProdId + "' AND OITM.ItmsGrpCod = ZSM108L.U_ItemGCod";
                                query = query + " Where ZSM108H.Code = '" + jCBP002.ReqList[i].InwhTypeDtlCd + "'";
                                _logger.LogWarning(query);

                                //쿼리 실행
                                command = new SqlCommand(query, connection);
                                reader = command.ExecuteReader();
                                reader.Read();

                                if (jCBP002.ReqList[i].InwhTypeDtlCd != "I-201") //소분입고가 아닐때만 이동평균처리
                                {
                                    var Price = reader.GetValue(1);
                                    oOIGN.Lines.UnitPrice = double.Parse(Price.ToString()); //이동평균처리
                                }

                                //oOIGN.Lines.LineNum = jCBP002L.ErpLineNo;
                                oOIGN.Lines.ItemCode = jCBP002L.IfProdId; //품목코드
                                //QTY수량 누적
                                QTYSUM = QTYSUM + jCBP002L.ExQty;
                                oOIGN.Lines.Quantity = QTYSUM; //수량
                                oOIGN.Lines.UoMEntry = 1; //수량(EA : UOM)
                                oOIGN.Lines.AccountCode = reader.GetString(0); //기타입출고계정                                 
                                oOIGN.Lines.WarehouseCode = jCBP002L.Towh;
                                oOIGN.Lines.UserFields.Fields.Item("U_LineType").Value = jCBP002.ReqList[i].InwhTypeDtlCd;
                                
                                //배치
                                oOIGN.Lines.BatchNumbers.BatchNumber = jCBP002L.ErpBatchNo; //jCBP002L.oITEMCODE + '@' + jCBP002L.oMNTDATE;
                                oOIGN.Lines.BatchNumbers.Quantity = jCBP002L.ExQty;
                                oOIGN.Lines.BatchNumbers.ExpiryDate = DateTime.ParseExact(jCBP002L.ExpYmd, "yyyyMMdd", null);
                                oOIGN.Lines.BatchNumbers.Add();

                                chk = (jCBP002L.ErpLineNo);

                                reader.Close();
                                j++;
                            }

                            //마지막행 문서 추가
                            DIresult = oOIGN.Add();

                            j = 0;
                            QTYSUM = 0;
                            chk = 0;

                            //오브젝트 초기화
                            if (oOIGN != null)
                            {
                                Marshal.ReleaseComObject(oOIGN);
                                oOIGN = null;
                            }

                            //DI 문서 오류 처리
                            if (DIresult != 0)
                            {
                                if (jCBP002.BizSeq == 1)
                                {
                                    ResultList.Add(new ResultListItem
                                    {
                                        IfKey = jCBP002.ReqList[i].IfKey,
                                        ProcBundleNo = jCBP002.ReqList[i].ProcBundleNo,
                                        Result = "E",
                                        Message = $"DI Error: ${MACRO_company.GetLastErrorCode()} - ${MACRO_company.GetLastErrorDescription()}"
                                    });
                                    //throw new Exception($"DI Error: ${MACRO_company.GetLastErrorCode()} - ${MACRO_company.GetLastErrorDescription()}");
                                }
                                else
                                {
                                    ResultList.Add(new ResultListItem
                                    {
                                        IfKey = jCBP002.ReqList[i].IfKey,
                                        ProcBundleNo = jCBP002.ReqList[i].ProcBundleNo,
                                        Result = "E",
                                        Message = $"DI Error: ${SJ_company.GetLastErrorCode()} - ${SJ_company.GetLastErrorDescription()}"
                                    });
                                    //throw new Exception($"DI Error: ${SJ_company.GetLastErrorCode()} - ${SJ_company.GetLastErrorDescription()}");
                                }
                            }
                            else
                            {
                                ResultList.Add(new ResultListItem
                                {
                                    IfKey = jCBP002.ReqList[i].IfKey,
                                    ProcBundleNo = jCBP002.ReqList[i].ProcBundleNo,
                                    Result = "S",
                                    Message = "처리 완료"
                                });
                            }
                            i++;
                        }
                    }
                    catch (Exception e)
                    {
                        ResultList.Add(new ResultListItem
                        {
                            IfKey = ReIfKey,
                            ProcBundleNo = ReProcBundleNo,
                            Result = "E",
                            Message = e.Message ?? "" //오류 메시지 값 리턴
                        });
                        _logger.LogWarning(e.Message);

                        //DB연결 종료
                        connection.Close();
                    }
                }

                int errType = 0;

                foreach (var item in ResultList)
                {
                    if (item.Result == "E")
                    {
                        errType++;
                    }
                }

                //결과값 전달
                var result = new cResult
                {
                    HttpResult = (errType > 0)? "E" : "S", // S:성공, E:실패
                    HttpMessage = (errType > 0)? "E" : "Success",
                    ResultList = ResultList
                };

                string ResultListString = string.Join(",", ResultList.Select(item =>
                    $"IfKey: {item.IfKey}, ProcBundleNo: {item.ProcBundleNo}, Result: {item.Result}, Message: {item.Message}"));
                string resultString = $"HttpResult: {result.HttpResult}, HttpMessage: {result.HttpMessage}, Results: [{ResultListString}]";
                _logger.LogWarning(resultString);

                //DB연결 종료
                connection.Close();

                if (oOPDN != null)
                {
                    Marshal.ReleaseComObject(oOPDN);
                    oOPDN = null;
                }
                if (oOIGN != null)
                {
                    Marshal.ReleaseComObject(oOIGN);
                    oOIGN = null;
                }

                return Ok(result);
            }
        }
    }
}