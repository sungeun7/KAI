using MACRO_WMS.Models;
using MACRO_WMS.SAP;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using SAPbobsCOM;
using System.Runtime.InteropServices;
using System.Text.Json;
using static Microsoft.EntityFrameworkCore.DbLoggerCategory;

/* [출하처리]
 * 샘플
{
  "apikey": "emdc",
  "bizSeq": "1",
  "reqList": [
    {
      "ifKey": "8841",
      "outbizTypeCd": "IW01",
      "centerSeq": "1",
      "wmsReqNo": "8841",
      "erpReqtypCd": "8841",
      "erpReqNo": "8841",
      "erpPickingNo": "8841",
      "etc_outbiz_type_cd": "8841",
      "procYmd": "20240827",
      "procHms": "120000",
      "procUserId": "MCR001",
      "prodList": [
        {
          "ifIdx": "0",
          "ifProdId": "11411-054",
          "exQty": "120",
          "expYmd": "20240930",          
          "lotNo": "11411-054-20240931",
          "erpBatchNo": "11411-054-20240827"
        },
        {
          "ifIdx": "1",
          "ifProdId": "11411-055",
          "exQty": "120",
          "expYmd": "20240930",
          "lotNo": "11411-055-20240931",
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

    public class CVA002Controller : ControllerBase
    {
        public class ApplicationDbContext : DbContext
        {
            public ApplicationDbContext(DbContextOptions<ApplicationDbContext> options) : base(options) { }
        }

        private readonly IConfiguration _configuration;
        private readonly ILogger<CVA002Controller> _logger;

        Dictionary<string, double> itemQuantities = new Dictionary<string, double>();

        bool isNewLine = false;

        // SAP 관련 기본 변수
        private readonly DIAPI _sapDIAPI;
        private int DIresult;

        //사용자변수
        private string oDocDate = "";
        public CVA002Controller(ILogger<CVA002Controller> logger, IConfiguration configuration, DIAPI sapDIAPI)
        {
            _logger = logger;
            _configuration = configuration;
            _sapDIAPI = sapDIAPI; 
        }

        /// <summary>
        /// 출하처리
        /// </summary>
        [HttpPost(Name = "CVA002")]
        public IActionResult GetItem([FromBody] CVA002 jCVA002)
        {
            _logger.LogWarning(jCVA002.ToString());

            // 객체를 JSON 문자열로 변환
            string jsonString = JsonSerializer.Serialize(jCVA002);

            _logger.LogWarning(jsonString);

            List<cResult> cResult = new List<cResult>();

            string connectionString = _configuration.GetConnectionString("DefaultConnection");
            string query = "";

            //SAP DI Connect
            Company MACRO_company = _sapDIAPI.Get_MACRO_Company();
            Company SJ_company = _sapDIAPI.Get_SJ_Company();
            Documents oODLN = null;
            Documents oOIGE = null;
            StockTransfer oOWTR = null;
            StockTransfer oOWTQ = null;
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
                if (jCVA002.APIKEY != "emdc")
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
                foreach (var jCVA002H in jCVA002.ReqList)
                {
                    try
                    {
                        ReIfKey = jCVA002H.IfKey;
                        ReProcBundleNo = jCVA002H.ProcBundleNo;

                        if (string.IsNullOrEmpty(jCVA002H.ErpPickingNo))
                        {
                            jCVA002H.ErpPickingNo = ""; // null 또는 빈 문자열인 경우 빈 문자열로 설정
                        }

                        if (string.IsNullOrEmpty(jCVA002H.EtcOutbizTypeCd))
                        {
                            jCVA002H.EtcOutbizTypeCd = ""; // null 또는 빈 문자열인 경우 빈 문자열로 설정
                        }

                        if (jCVA002.ReqList[i].ErpReqTypCd == "ORDR")
                        {
                            if (jCVA002.BizSeq == 1)
                            {
                                oODLN = (Documents)MACRO_company.GetBusinessObject(BoObjectTypes.oDeliveryNotes);
                            }
                            else
                            {
                                oODLN = (Documents)SJ_company.GetBusinessObject(BoObjectTypes.oDeliveryNotes);
                            }

                            //헤더
                            query = "SELECT CardCode FROM " + sDB.SAPDB(jCVA002.BizSeq.ToString()) + "..ORDR WHERE DocEntry = '" + jCVA002.ReqList[i].ErpReqNo + "'"; //241218 string 삭제
                            _logger.LogWarning(query);

                            //쿼리 실행
                            command = new SqlCommand(query, connection);
                            reader = command.ExecuteReader();
                            reader.Read();

                            //헤더
                            oODLN.CardCode = reader.GetString(0); //거래처코드
                            oODLN.DocDate = DateTime.ParseExact(jCVA002H.ProcYmd, "yyyyMMdd", null); //전기일
                            oODLN.DocDueDate = DateTime.ParseExact(jCVA002H.ProcYmd, "yyyyMMdd", null); //만기일
                            oODLN.TaxDate = DateTime.ParseExact(jCVA002H.ProcYmd, "yyyyMMdd", null); //증빙일
                            oODLN.BPL_IDAssignedToInvoice = 1; //사업장
                            oODLN.DocObjectCode = BoObjectTypes.oDeliveryNotes;//배송문서로 변경
                            oODLN.DocType = BoDocumentTypes.dDocument_Items;//품목(품목/서비스)
                            oODLN.UserFields.Fields.Item("U_WMSDOCNUM").Value = jCVA002.ReqList[i].WmsReqNo;
                            oODLN.UserFields.Fields.Item("U_WMSNUM").Value = jCVA002H.ProcBundleNo;
                            //oODLN.Comments = ""; //비고
                            reader.Close();

                            //본문
                            foreach (var jCVA002L in jCVA002.ReqList[i].ProdList)
                            {
                                if ((jCVA002L.ErpLineNo) != chk)
                                {
                                    if (j != 0) { oODLN.Lines.Add(); }
                                    QTYSUM = 0;
                                }

                                //라인
                                oODLN.Lines.BaseType = 17; //원천문서 타입
                                oODLN.Lines.BaseEntry = int.Parse(jCVA002.ReqList[i].ErpReqNo); //원천문서
                                oODLN.Lines.BaseLine = jCVA002L.ErpLineNo; //원천라인

                                //string query1 = "SELECT LineTotal FROM RDR1 WHERE DocEntry = '" + jCVA002.ReqList[i].ErpReqNo + "' AND LineNum = '" + jCVA002L.ErpLineNo + "'"; //241203 test
                                string query1 = "SELECT (CASE WHEN LineTotal > 0 AND UOMCODE <> 'EA' THEN LineTotal / InvQty ELSE Price END), LineTotal FROM " + sDB.SAPDB(jCVA002.BizSeq.ToString()) + "..RDR1 WHERE DocEntry = '" + jCVA002.ReqList[i].ErpReqNo + "' AND LineNum = '" + jCVA002L.ErpLineNo + "'"; //241203 test
                                //_logger.LogWarning(query1);

                                //쿼리 실행
                                command = new SqlCommand(query1, connection);
                                reader = command.ExecuteReader();
                                reader.Read();

                                oODLN.Lines.UnitPrice = (double)reader.GetDecimal(0); //단가
                                //oODLN.Lines.LineTotal = (double)reader.GetDecimal(1); //총계
                                reader.Close();

                                //oODLN.Lines.LineNum = jCVA002L.IfIdx; //수량
                                oODLN.Lines.ItemCode = jCVA002L.IfProdId; //품목코드
                                QTYSUM = QTYSUM + jCVA002L.ExQty;
                                oODLN.Lines.Quantity = QTYSUM; //수량
                                oODLN.Lines.UoMEntry = 1; //수량(EA : UOM)

                                //배치
                                oODLN.Lines.BatchNumbers.BatchNumber = jCVA002L.ErpBatchNo; //배치번호 jCVA002L.oITEMCODE + '@' + jCVA002L.oEXPDATE;
                                oODLN.Lines.BatchNumbers.Quantity = jCVA002L.ExQty; //수량(EA)
                                oODLN.Lines.BatchNumbers.Add();

                                chk = (jCVA002L.ErpLineNo);

                                j++;
                            }

                            //마지막행 문서 추가
                            DIresult = oODLN.Add();

                            j = 0;
                            QTYSUM = 0;
                            chk = 0;

                            //오브젝트 초기화
                            Marshal.ReleaseComObject(oODLN);
                            oODLN = null;
                            
                            //DI 문서 오류 처리
                            if (DIresult != 0)
                            {
                                if (jCVA002.BizSeq == 1)
                                {
                                    ResultList.Add(new ResultListItem
                                    {
                                        IfKey = jCVA002.ReqList[i].IfKey,
                                        ProcBundleNo = jCVA002.ReqList[i].ProcBundleNo,
                                        Result = "E",
                                        Message = $"DI Error: ${MACRO_company.GetLastErrorCode()} - ${MACRO_company.GetLastErrorDescription()}"
                                    });
                                    //throw new Exception($"DI Error: ${MACRO_company.GetLastErrorCode()} - ${MACRO_company.GetLastErrorDescription()}");
                                }
                                else
                                {
                                    ResultList.Add(new ResultListItem
                                    {
                                        IfKey = jCVA002.ReqList[i].IfKey,
                                        ProcBundleNo = jCVA002.ReqList[i].ProcBundleNo,
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
                                    IfKey = jCVA002.ReqList[i].IfKey,
                                    ProcBundleNo = jCVA002.ReqList[i].ProcBundleNo,
                                    Result = "S",
                                    Message = "처리 완료"
                                });
                            }
                            i++;
                        }
                        else if (jCVA002.ReqList[i].ErpReqTypCd == "OWTQ" && jCVA002.ReqList[i].EtcOutbizTypeCd == "") //재고이전
                        {
                            if (jCVA002.BizSeq == 1)
                            {
                                oOWTR = (StockTransfer)MACRO_company.GetBusinessObject(BoObjectTypes.oStockTransfer);
                            }
                            else
                            {
                                oOWTR = (StockTransfer)SJ_company.GetBusinessObject(BoObjectTypes.oStockTransfer);
                            }

                            ////헤더
                            //string query = "SELECT CardCode FROM " + sDB.SAPDB(jCVA002.BizSeq.ToString()) + "..OWTQ WHERE DocEntry = '" + jCVA002.ReqList[i].ErpReqNo + "'";
                            //_logger.LogWarning(query);

                            ////쿼리 실행
                            //command = new SqlCommand(query, connection);RT20241205-00002
                            //reader = command.ExecuteReader();
                            //reader.Read();

                            //본문
                            foreach (var jCVA002L in jCVA002.ReqList[i].ProdList)
                            {
                                if ((jCVA002L.ErpLineNo) != chk)
                                {
                                    if (j != 0) { oOWTR.Lines.Add(); }
                                    QTYSUM = 0;
                                }

                                //헤더
                                oOWTR.DocDate = DateTime.ParseExact(jCVA002.ReqList[i].ProcYmd, "yyyyMMdd", null);
                                oOWTR.TaxDate = DateTime.ParseExact(jCVA002.ReqList[i].ProcYmd, "yyyyMMdd", null);
                                oOWTR.UserFields.Fields.Item("U_WMSDOCNUM").Value = jCVA002.ReqList[i].WmsReqNo;
                                oOWTR.UserFields.Fields.Item("U_WMSNUM").Value = jCVA002H.ProcBundleNo;
                                //oOWTR.Comments = "";

                                //라인
                                if (isNewLine == false)
                                {
                                    oOWTR.Lines.BaseType = InvBaseDocTypeEnum.InventoryTransferRequest; //원천문서 타입
                                    oOWTR.Lines.BaseEntry = int.Parse(jCVA002.ReqList[i].ErpReqNo); //원천문서
                                    oOWTR.Lines.BaseLine = jCVA002L.ErpLineNo; //원천라인
                                }

                                //oOWTR.Lines.LineNum = jCVA002L.IfIdx;
                                oOWTR.Lines.ItemCode = jCVA002L.IfProdId; //품목코드
                                QTYSUM = QTYSUM + jCVA002L.ExQty;
                                oOWTR.Lines.InventoryQuantity = QTYSUM; //수량
                                oOWTR.Lines.UoMEntry = 1; //수량(EA : UOM)

                                chk = (jCVA002L.ErpLineNo);

                                //배치
                                oOWTR.Lines.BatchNumbers.BatchNumber = jCVA002L.ErpBatchNo; //jCVA002L.oITEMCODE + '@' + jCVA002L.oEXPDATE;
                                oOWTR.Lines.BatchNumbers.Quantity = jCVA002L.ExQty;
                                oOWTR.Lines.BatchNumbers.Add();
                                j++;
                            }

                            //마지막행 문서 추가
                            DIresult = oOWTR.Add();

                            j = 0;
                            QTYSUM = 0;
                            chk = 0;

                            //오브젝트 초기화
                            if (oOWTR != null)
                            {
                                Marshal.ReleaseComObject(oOWTR);
                                oOWTR = null;
                            }

                            //reader.Close();

                            //DI 문서 오류 처리
                            if (DIresult != 0)
                            {
                                if (jCVA002.BizSeq == 1)
                                {
                                    ResultList.Add(new ResultListItem
                                    {
                                        IfKey = jCVA002.ReqList[i].IfKey,
                                        ProcBundleNo = jCVA002.ReqList[i].ProcBundleNo,
                                        Result = "E",
                                        Message = $"DI Error: ${MACRO_company.GetLastErrorCode()} - ${MACRO_company.GetLastErrorDescription()}"
                                    });
                                    //throw new Exception($"DI Error: ${MACRO_company.GetLastErrorCode()} - ${MACRO_company.GetLastErrorDescription()}");
                                }
                                else
                                {
                                    ResultList.Add(new ResultListItem
                                    {
                                        IfKey = jCVA002.ReqList[i].IfKey,
                                        ProcBundleNo = jCVA002.ReqList[i].ProcBundleNo,
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
                                    IfKey = jCVA002.ReqList[i].IfKey,
                                    ProcBundleNo = jCVA002.ReqList[i].ProcBundleNo,
                                    Result = "S",
                                    Message = "처리 완료"
                                });
                            }
                            i++;
                        }
                        else //기타출고
                        {
                            if (jCVA002.BizSeq == 1)
                            {
                                oOIGE = (Documents)MACRO_company.GetBusinessObject(BoObjectTypes.oInventoryGenExit);
                                oOWTQ = (StockTransfer)MACRO_company.GetBusinessObject(BoObjectTypes.oInventoryTransferRequest);
                            }
                            else
                            {
                                oOIGE = (Documents)SJ_company.GetBusinessObject(BoObjectTypes.oInventoryGenExit);
                                oOWTQ = (StockTransfer)SJ_company.GetBusinessObject(BoObjectTypes.oInventoryTransferRequest);
                            }

                            //재고이전요청 닫기 //241223 수정
                            oOWTQ.GetByKey(int.Parse(jCVA002.ReqList[i].ErpReqNo));
                            oOWTQ.Close();

                            //헤더
                            oOIGE.DocDate = DateTime.ParseExact(jCVA002H.ProcYmd, "yyyyMMdd", null);
                            oOIGE.DocDueDate = DateTime.ParseExact(jCVA002H.ProcYmd, "yyyyMMdd", null);
                            oOIGE.TaxDate = DateTime.ParseExact(jCVA002H.ProcYmd, "yyyyMMdd", null);
                            oOIGE.UserFields.Fields.Item("U_WMSDOCNUM").Value = jCVA002.ReqList[i].WmsReqNo;
                            oOIGE.UserFields.Fields.Item("U_WMSNUM").Value = jCVA002H.ProcBundleNo;
                            oOIGE.UserFields.Fields.Item("U_SAPNUM").Value = jCVA002H.ErpReqNo;
                            
                            query = " SELECT Comments FROM " + sDB.SAPDB(jCVA002.BizSeq.ToString()) + "..OWTQ "; //241218 추가
                            query = query + " Where DocEntry = '" + jCVA002.ReqList[i].ErpReqNo + "'";
                            _logger.LogWarning(query);
                            
                            //쿼리 실행
                            command = new SqlCommand(query, connection);
                            reader = command.ExecuteReader();
                            reader.Read();

                            oOIGE.Comments = reader.IsDBNull(0) ? string.Empty : reader.GetString(0); //241218 추가
                                                        
                            reader.Close();

                            if (jCVA002.ReqList[i].EtcOutbizTypeCd == "I-201") //소분입고일때만 가격리스트(국내매입단가:부가세별도)
                            {
                                oOIGE.GroupNumber = 30;
                            }

                            //본문
                            foreach (var jCVA002L in jCVA002.ReqList[i].ProdList)
                            {
                                if ((jCVA002L.ErpLineNo) != chk)
                                {
                                    if (j != 0)
                                    {
                                        oOIGE.Lines.Add();
                                        QTYSUM = 0;
                                    }
                                }

                                //기타입출고 계정 조회
                                query = " SELECT ZSM108L.U_AcctCode,OITM.AvgPrice "; //241218 string 삭제
                                query = query + " From " + sDB.SAPDB(jCVA002.BizSeq.ToString()) + "..[@ZSM108H] ZSM108H";
                                query = query + " LEFT JOIN " + sDB.SAPDB(jCVA002.BizSeq.ToString()) + "..[@ZSM108L] ZSM108L ON ZSM108H.Code = ZSM108L.Code";
                                query = query + " LEFT JOIN " + sDB.SAPDB(jCVA002.BizSeq.ToString()) + "..[OITB] OITB ON OITB.ItmsGrpCod = ZSM108L.U_ItemGCod";
                                query = query + " LEFT JOIN " + sDB.SAPDB(jCVA002.BizSeq.ToString()) + "..[OITM] OITM ON OITM.ItemCode = '" + jCVA002L.IfProdId + "' AND OITM.ItmsGrpCod = ZSM108L.U_ItemGCod";
                                query = query + " Where ZSM108H.Code = '" + jCVA002.ReqList[i].EtcOutbizTypeCd + "'";
                                _logger.LogWarning(query);

                                //쿼리 실행
                                command = new SqlCommand(query, connection);
                                reader = command.ExecuteReader();
                                reader.Read();

                                oOIGE.Lines.ItemCode = jCVA002L.IfProdId; //품목코드
                                QTYSUM = QTYSUM + jCVA002L.ExQty;
                                oOIGE.Lines.InventoryQuantity = QTYSUM; //수량
                                oOIGE.Lines.UoMEntry = 1; //수량(EA : UOM)
                                oOIGE.Lines.WarehouseCode = jCVA002L.FrWh;
                                oOIGE.Lines.AccountCode = reader.GetString(0); //기타입출고계정
                                oOIGE.Lines.UserFields.Fields.Item("U_LineType").Value = jCVA002.ReqList[i].EtcOutbizTypeCd;

                                if (jCVA002.ReqList[i].EtcOutbizTypeCd != "I-201") //소분입고가 아닐때만 이동평균처리
                                {
                                    var Price = reader.GetValue(1);
                                    oOIGE.Lines.UnitPrice = double.Parse(Price.ToString()); //이동평균처리
                                }

                                chk = (jCVA002L.ErpLineNo);

                                //배치 
                                oOIGE.Lines.BatchNumbers.BatchNumber = jCVA002L.ErpBatchNo; //jCVA002L.oITEMCODE + '@' + jCVA002L.oEXPDATE;
                                oOIGE.Lines.BatchNumbers.Quantity = jCVA002L.ExQty;
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
                            if (oOIGE != null)
                            {
                                Marshal.ReleaseComObject(oOIGE);
                                oOIGE = null;
                            }
                            if (oOWTQ != null)
                            {
                                Marshal.ReleaseComObject(oOWTQ);
                                oOWTQ = null;
                            }

                            //DI 문서 오류 처리
                            if (DIresult != 0)
                            {
                                if (jCVA002.BizSeq == 1)
                                {
                                    ResultList.Add(new ResultListItem
                                    {
                                        IfKey = jCVA002.ReqList[i].IfKey,
                                        ProcBundleNo = jCVA002.ReqList[i].ProcBundleNo,
                                        Result = "E",
                                        Message = $"DI Error: ${MACRO_company.GetLastErrorCode()} - ${MACRO_company.GetLastErrorDescription()}"
                                    });
                                    //throw new Exception($"DI Error: ${MACRO_company.GetLastErrorCode()} - ${MACRO_company.GetLastErrorDescription()}");
                                }
                                else
                                {
                                    ResultList.Add(new ResultListItem
                                    {
                                        IfKey = jCVA002.ReqList[i].IfKey,
                                        ProcBundleNo = jCVA002.ReqList[i].ProcBundleNo,
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
                                    IfKey = jCVA002.ReqList[i].IfKey,
                                    ProcBundleNo = jCVA002.ReqList[i].ProcBundleNo,
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

                if (oODLN != null)
                {
                    Marshal.ReleaseComObject(oODLN);
                    oODLN = null;
                }
                if (oOWTR != null)
                {
                    Marshal.ReleaseComObject(oOWTR);
                    oOWTR = null;
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