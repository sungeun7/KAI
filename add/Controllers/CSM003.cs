using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Data.SqlClient;
using MACRO_WMS.Models;
using System.Reflection.PortableExecutable;
using System.Text.Json;
using SAPbobsCOM;
using MACRO_WMS.SAP;
using System.Runtime.InteropServices;
using static Microsoft.EntityFrameworkCore.DbLoggerCategory;

/* [예외출고처리]
 * 샘플
{
  "apikey": "emdc",
  "bizSeq": "1",
  "reqList": [
    {
      "ifKey": "8841",
      "etcTypeCd": "EX95",
      "wmsReqNo": "IW01",
      "erpReqNo": "8841",
      "procYmd": "20240827",
      "procHms": "120000",
      "procUserId": "MCR001",
      "prodList": [
        {
          "ifIdx": "0",
          "ifProdId": "11411-054",
          "exQty": "120",
          "lotNo": "11411-054-20240931",
          "expYmd": "20240930",
          "erpBatchNo": "11411-054-20240827"
        },
        {
          "ifIdx": "1",
          "ifProdId": "11411-055",
          "exQty": "120",
          "lotNo": "11411-055-20240931",
          "expYmd": "20240930",
          "erpBatchNo": "11411-054-20240827"
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

    public class CSM003Controller : ControllerBase
    {
        public class ApplicationDbContext : DbContext
        {
            public ApplicationDbContext(DbContextOptions<ApplicationDbContext> options) : base(options) { }
        }

        private readonly IConfiguration _configuration;
        private readonly ILogger<CSM003Controller> _logger;

        Dictionary<string, double> itemQuantities = new Dictionary<string, double>();

        bool isNewLine = false;

        // SAP 관련 기본 변수
        private readonly DIAPI _sapDIAPI;
        private int DIresult;

        //사용자변수
        private string oDocDate = "";

        public CSM003Controller(ILogger<CSM003Controller> logger, IConfiguration configuration, DIAPI sapDIAPI)
        {
            _logger = logger;
            _configuration = configuration;
            _sapDIAPI = sapDIAPI;
        }
        
        /// <summary>
        /// 예외출고처리
        /// </summary>
        [HttpPost(Name = "CSM003")]
        public IActionResult GetItem([FromBody] CSM003 jCSM003)
        {
            _logger.LogWarning(jCSM003.ToString());

            // 객체를 JSON 문자열로 변환
            string jsonString = JsonSerializer.Serialize(jCSM003);

            _logger.LogWarning(jsonString);

            List<cResult> cResult = new List<cResult>();

            string connectionString = _configuration.GetConnectionString("DefaultConnection");

            //SAP DI Connect
            Company MACRO_company = _sapDIAPI.Get_MACRO_Company();
            Company SJ_company = _sapDIAPI.Get_SJ_Company();
            Documents oORPD = null;
            Documents oOIGE = null;
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
                if (jCSM003.APIKEY != "emdc")
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
                foreach (var jCSM003H in jCSM003.ReqList)
                {
                    try
                    {
                        ReIfKey = jCSM003H.IfKey;
                        ReProcBundleNo = jCSM003H.ProcBundleNo;

                        if (string.IsNullOrEmpty(jCSM003H.ErpReqNo))
                        {
                            jCSM003H.ErpReqNo = ""; // null 또는 빈 문자열인 경우 빈 문자열로 설정
                        }

                        if (jCSM003.BizSeq == 1)
                        {
                            oORPD = (Documents)MACRO_company.GetBusinessObject(BoObjectTypes.oPurchaseReturns);
                            oOIGE = (Documents)MACRO_company.GetBusinessObject(BoObjectTypes.oInventoryGenExit);
                        }
                        else if (jCSM003.BizSeq == 2)
                        {
                            oORPD = (Documents)SJ_company.GetBusinessObject(BoObjectTypes.oPurchaseReturns);
                            oOIGE = (Documents)SJ_company.GetBusinessObject(BoObjectTypes.oInventoryGenExit);
                        }
                       
                        if (jCSM003.ReqList[i].EtcTypeCd == "EX95")
                        {
                            string query = "SELECT CardCode FROM " + sDB.SAPDB(jCSM003.BizSeq.ToString()) + "..OPRR WHERE DocEntry = '" + jCSM003.ReqList[i].ErpReqNo + "'";
                            _logger.LogWarning(query);

                            //쿼리 실행
                            command = new SqlCommand(query, connection);
                            reader = command.ExecuteReader();
                            reader.Read();

                            //본문
                            foreach (var jCSM003L in jCSM003.ReqList[i].ProdList)
                            {
                                if ((jCSM003L.ErpLineNo) != chk)
                                {
                                    if (j != 0)
                                    {
                                        oORPD.Lines.Add();
                                        QTYSUM = 0;
                                    }
                                }

                                //헤더
                                oORPD.CardCode = reader.GetString(0); //거래처코드
                                oORPD.DocDate = DateTime.ParseExact(jCSM003H.ProcYmd, "yyyyMMdd", null); //전기일
                                oORPD.DocDueDate = DateTime.ParseExact(jCSM003H.ProcYmd, "yyyyMMdd", null); //만기일
                                oORPD.TaxDate = DateTime.ParseExact(jCSM003H.ProcYmd, "yyyyMMdd", null); //증빙일
                                oORPD.BPL_IDAssignedToInvoice = 1; //사업장
                                oORPD.DocObjectCode = BoObjectTypes.oPurchaseReturns;//판매오더로 변경
                                oORPD.DocType = BoDocumentTypes.dDocument_Items;//품목(품목/서비스)
                                oORPD.UserFields.Fields.Item("U_WMSDOCNUM").Value = jCSM003.ReqList[i].WmsReqNo;
                                oORPD.UserFields.Fields.Item("U_WMSNUM").Value = jCSM003H.ProcBundleNo;
                                //oORPD.Comments = "";

                                //라인
                                if (isNewLine == false)
                                {
                                    oORPD.Lines.BaseType = 234000032; //원천문서 타입
                                    oORPD.Lines.BaseEntry = int.Parse(jCSM003.ReqList[i].ErpReqNo); //원천문서
                                    oORPD.Lines.BaseLine = jCSM003L.ErpLineNo; //원천라인
                                }

                                //oORPD.Lines.LineNum = jCSM003L.IfIdx;
                                oORPD.Lines.ItemCode = jCSM003L.IfProdId;
                                QTYSUM = QTYSUM + jCSM003L.ExQty;
                                oORPD.Lines.InventoryQuantity = QTYSUM;
                                oORPD.Lines.UoMEntry = 1; //수량(EA : UOM)

                                chk = (jCSM003L.ErpLineNo);

                                //배치
                                oORPD.Lines.BatchNumbers.ExpiryDate = DateTime.ParseExact(jCSM003L.ExpYmd, "yyyyMMdd", null);
                                oORPD.Lines.BatchNumbers.Quantity = jCSM003L.ExQty;
                                oORPD.Lines.BatchNumbers.BatchNumber = jCSM003L.ErpBatchNo; //jCSM003L.oITEMCODE + '@' + jCSM003L.oEXPDATE;
                                oORPD.Lines.BatchNumbers.Add();
                                j++;
                            }

                            //마지막행 문서 추가
                            DIresult = oORPD.Add();

                            j = 0;
                            QTYSUM = 0;
                            chk = 0;

                            //오브젝트 초기화
                            Marshal.ReleaseComObject(oORPD);
                            oORPD = null;
                            reader.Close();

                            //DI 문서 오류 처리
                            if (DIresult != 0)
                            {
                                if (jCSM003.BizSeq == 1)
                                {
                                    ResultList.Add(new ResultListItem
                                    {
                                        IfKey = jCSM003.ReqList[i].IfKey,
                                        ProcBundleNo = jCSM003.ReqList[i].ProcBundleNo,
                                        Result = "E",
                                        Message = $"DI Error: ${MACRO_company.GetLastErrorCode()} - ${MACRO_company.GetLastErrorDescription()}"
                                    });
                                    //throw new Exception($"DI Error: ${MACRO_company.GetLastErrorCode()} - ${MACRO_company.GetLastErrorDescription()}");
                                }
                                else
                                {
                                    ResultList.Add(new ResultListItem
                                    {
                                        IfKey = jCSM003.ReqList[i].IfKey,
                                        ProcBundleNo = jCSM003.ReqList[i].ProcBundleNo,
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
                                    IfKey = jCSM003.ReqList[i].IfKey,
                                    ProcBundleNo = jCSM003.ReqList[i].ProcBundleNo,
                                    Result = "S",
                                    Message = "처리 완료"
                                });
                            }
                            i++;
                        }
                        else
                        {
                            //본문
                            foreach (var jCSM003L in jCSM003.ReqList[i].ProdList)
                            {
                                if ((jCSM003L.ErpLineNo) != chk)
                                {
                                    if (j != 0)
                                    {
                                        oOIGE.Lines.Add();
                                        QTYSUM = 0;
                                    }
                                }

                                //라인
                                //기타입출고 계정 조회
                                string query = " SELECT ZSM108L.U_AcctCode,OITM.AvgPrice ";
                                query = query + " From " + sDB.SAPDB(jCSM003.BizSeq.ToString()) + "..[@ZSM108H] ZSM108H";
                                query = query + " LEFT JOIN " + sDB.SAPDB(jCSM003.BizSeq.ToString()) + "..[@ZSM108L] ZSM108L ON ZSM108H.Code = ZSM108L.Code";
                                query = query + " LEFT JOIN " + sDB.SAPDB(jCSM003.BizSeq.ToString()) + "..[OITB] OITB ON OITB.ItmsGrpCod = ZSM108L.U_ItemGCod";
                                query = query + " LEFT JOIN " + sDB.SAPDB(jCSM003.BizSeq.ToString()) + "..[OITM] OITM ON OITM.ItemCode = '" + jCSM003L.IfProdId + "' AND OITM.ItmsGrpCod = ZSM108L.U_ItemGCod";
                                query = query + " Where ZSM108H.Code = '" + jCSM003.ReqList[i].EtcTypeCd + "'";
                                _logger.LogWarning(query);

                                //쿼리 실행
                                command = new SqlCommand(query, connection);
                                reader = command.ExecuteReader();
                                reader.Read();

                                if (jCSM003.ReqList[i].EtcTypeCd != "I-201") //소분입고가 아닐때만 이동평균처리
                                {
                                    var Price = reader.GetValue(1);
                                    oOIGE.Lines.UnitPrice = double.Parse(Price.ToString()); //이동평균처리
                                }

                                oOIGE.DocDate = DateTime.ParseExact(jCSM003H.ProcYmd, "yyyyMMdd", null); //전기일
                                oOIGE.UserFields.Fields.Item("U_WMSDOCNUM").Value = jCSM003.ReqList[i].WmsReqNo;
                                oOIGE.UserFields.Fields.Item("U_WMSNUM").Value = jCSM003H.ProcBundleNo;
                                oOIGE.Comments = jCSM003H.Note;;

                                //oOIGE.Lines.LineNum = jCSM003L.IfIdx;
                                oOIGE.Lines.ItemCode = jCSM003L.IfProdId;
                                QTYSUM = QTYSUM + jCSM003L.ExQty;
                                oOIGE.Lines.InventoryQuantity = QTYSUM; //수량
                                oOIGE.Lines.AccountCode = reader.GetString(0); //기타입출고계정 
                                //oOIGE.Lines.UoMEntry = 1; //수량(EA : UOM)
                                oOIGE.Lines.WarehouseCode = jCSM003L.FrWh;
                                oOIGE.Lines.UserFields.Fields.Item("U_LineType").Value = jCSM003.ReqList[i].EtcTypeCd;
                                
                                chk = (jCSM003L.ErpLineNo);

                                //배치
                                oOIGE.Lines.BatchNumbers.ExpiryDate = DateTime.ParseExact(jCSM003L.ExpYmd, "yyyyMMdd", null);
                                oOIGE.Lines.BatchNumbers.Quantity = jCSM003L.ExQty;
                                oOIGE.Lines.BatchNumbers.BatchNumber = jCSM003L.ErpBatchNo; //jCSM003L.oITEMCODE + '@' + jCSM003L.oEXPDATE;
                                oOIGE.Lines.BatchNumbers.Add();
                                j++;
                                reader.Close();
                            }

                            //마지막행 문서 추가
                            DIresult = oOIGE.Add();

                            j = 0;
                            QTYSUM = 0;
                            chk = 0;

                            //오브젝트 초기화
                            Marshal.ReleaseComObject(oOIGE);
                            oOIGE = null;

                            //DI 문서 오류 처리
                            if (DIresult != 0)
                            {
                                if (jCSM003.BizSeq == 1)
                                {
                                    ResultList.Add(new ResultListItem
                                    {
                                        IfKey = jCSM003.ReqList[i].IfKey,
                                        ProcBundleNo = jCSM003.ReqList[i].ProcBundleNo,
                                        Result = "E",
                                        Message = $"DI Error: ${MACRO_company.GetLastErrorCode()} - ${MACRO_company.GetLastErrorDescription()}"
                                    });
                                    //throw new Exception($"DI Error: ${MACRO_company.GetLastErrorCode()} - ${MACRO_company.GetLastErrorDescription()}");
                                }
                                else
                                {
                                    ResultList.Add(new ResultListItem
                                    {
                                        IfKey = jCSM003.ReqList[i].IfKey,
                                        ProcBundleNo = jCSM003.ReqList[i].ProcBundleNo,
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
                                    IfKey = jCSM003.ReqList[i].IfKey,
                                    ProcBundleNo = jCSM003.ReqList[i].ProcBundleNo,
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
                    HttpResult = (errType > 0) ? "E" : "S", // S:성공, E:실패
                    HttpMessage = (errType > 0) ? "E" : "Success",
                    ResultList = ResultList
                };

                string ResultListString = string.Join(",", ResultList.Select(item =>
                    $"IfKey: {item.IfKey}, ProcBundleNo: {item.ProcBundleNo}, Result: {item.Result}, Message: {item.Message}"));
                string resultString = $"HttpResult: {result.HttpResult}, HttpMessage: {result.HttpMessage}, Results: [{ResultListString}]";
                _logger.LogWarning(resultString);

                //DB연결 종료
                connection.Close();

                if (oORPD != null)
                {
                    Marshal.ReleaseComObject(oORPD);
                    oORPD = null;
                }
                if (oOIGE != null)
                {
                    Marshal.ReleaseComObject(oOIGE);
                    oOIGE = null;
                }

                return Ok(result);
            }
        }
    }
}