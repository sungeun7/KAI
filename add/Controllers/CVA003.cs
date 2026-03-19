using MACRO_WMS.Models;
using MACRO_WMS.SAP;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using SAPbobsCOM;
using System.Reflection.PortableExecutable;
using System.Runtime.InteropServices;
using System.Text.Json;
using static Microsoft.EntityFrameworkCore.DbLoggerCategory;
using static Microsoft.EntityFrameworkCore.DbLoggerCategory.Database;

/* [출하처리취소]
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
      "erpReqTypCd": "1",
      "erpReqNo": "13078",
      "erpPickingNo": "1",
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

    public class CVA003Controller : ControllerBase
    {
        public class ApplicationDbContext : DbContext
        {
            public ApplicationDbContext(DbContextOptions<ApplicationDbContext> options) : base(options) { }
        }

        private readonly IConfiguration _configuration;
        private readonly ILogger<CVA003Controller> _logger;

        Dictionary<string, double> itemQuantities = new Dictionary<string, double>();

        bool isNewLine = false;

        // SAP 관련 기본 변수
        private readonly DIAPI _sapDIAPI;
        private int DIresult;
        SqlCommand command;
        SqlDataReader reader;

        //사용자변수
        private string oDocDate = "";

        public CVA003Controller(ILogger<CVA003Controller> logger, IConfiguration configuration, DIAPI sapDIAPI)
        {
            _logger = logger;
            _configuration = configuration;
            _sapDIAPI = sapDIAPI; 
        }
        
        /// <summary>
        /// 출하처리취소
        /// </summary>
        [HttpPost(Name = "CVA003")]
        public IActionResult GetItem([FromBody] CVA003 jCVA003)
        {
            _logger.LogWarning(jCVA003.ToString());

            // 객체를 JSON 문자열로 변환
            string jsonString = JsonSerializer.Serialize(jCVA003);

            _logger.LogWarning(jsonString);

            List<cResult> cResult = new List<cResult>();

            string connectionString = _configuration.GetConnectionString("DefaultConnection");
            string query = "";

            //SAP DI Connect
            Company MACRO_company = _sapDIAPI.Get_MACRO_Company();
            Company SJ_company = _sapDIAPI.Get_SJ_Company();
            Documents oODLN = null;
            StockTransfer oOWTR = null;
            Documents oOIGE = null;
            Documents oOIGN = null;
            Documents cancelDoc = null;
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
                if (jCVA003.APIKEY != "emdc")
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

                //중복된 행 제거
                var distinctReqList = jCVA003.ReqList
                .GroupBy(x => x.ProcBundleNo)
                .Select(g => g.First())
                .ToList();

                //SQL 쿼리문 작성부분
                foreach (var jCVA003H in distinctReqList)
                {
                    try
                    {
                        ReIfKey = jCVA003H.IfKey;
                        ReProcBundleNo = jCVA003H.ProcBundleNo;

                        if (string.IsNullOrEmpty(jCVA003H.ErpPickingNo))
                        {
                            jCVA003H.ErpPickingNo = ""; // null 또는 빈 문자열인 경우 빈 문자열로 설정
                        }

                        if (jCVA003.BizSeq == 1)
                        {
                            //query = "UPDATE " + sDB.SAPDB(jCVA003.BizSeq.ToString()) + "..PKL1 SET U_WMSNY = 'C' WHERE DocEntry = '" + jCVA003.ReqList[i].ErpReqNo + "'";
                            //query = "UPDATE " + sDB.SAPDB(jCVA003.BizSeq.ToString()) + "..OWTQ SET U_WMSNY = 'C' WHERE DocEntry = '" + jCVA003.ReqList[i].ErpReqNo + "'";
                            query = "UPDATE " + sDB.SAPDB(jCVA003.BizSeq.ToString()) + "..ORDR SET U_WMSNY = 'N' WHERE DocEntry = '" + jCVA003.ReqList[i].ErpReqNo + "'";
                        }
                        else if (jCVA003.BizSeq == 2)
                        {
                            //query = "UPDATE " + sDB.SAPDB(jCVA003.BizSeq.ToString()) + "..PKL1 SET U_WMSNY = 'C' WHERE DocEntry = '" + jCVA003.ReqList[i].ErpReqNo + "'";
                            //query = "UPDATE " + sDB.SAPDB(jCVA003.BizSeq.ToString()) + "..OWTQ SET U_WMSNY = 'C' WHERE DocEntry = '" + jCVA003.ReqList[i].ErpReqNo + "'";
                            query = "UPDATE " + sDB.SAPDB(jCVA003.BizSeq.ToString()) + "..ORDR SET U_WMSNY = 'N' WHERE DocEntry = '" + jCVA003.ReqList[i].ErpReqNo + "'";
                        }

                        if (jCVA003H.ErpReqTypCd == "ORDR") //입고유형이 없으면 입고PO
                        {
                            if (jCVA003.BizSeq == 1)
                            {
                                oODLN = (Documents)MACRO_company.GetBusinessObject(BoObjectTypes.oDeliveryNotes);
                            }
                            else
                            {
                                oODLN = (Documents)SJ_company.GetBusinessObject(BoObjectTypes.oDeliveryNotes);
                            }

                            //구매오더 기준 입고문서 조회
                            query = " SELECT DocEntry FROM " + sDB.SAPDB(jCVA003.BizSeq.ToString()) + "..ODLN ";
                            query = query + " Where U_WMSDOCNUM = '" + jCVA003.ReqList[i].WmsReqNo + "'";
                            query = query + "   AND U_WMSNUM = '" + jCVA003.ReqList[i].ProcBundleNo + "'";
                            _logger.LogWarning(query);

                            //쿼리 실행
                            command = new SqlCommand(query, connection);
                            reader = command.ExecuteReader();
                            reader.Read();

                            //헤더
                            oODLN.GetByKey(int.Parse(reader.GetInt32(0).ToString()));
                            cancelDoc = oODLN.CreateCancellationDocument();
                            cancelDoc.DocDate = DateTime.ParseExact(jCVA003.ReqList[i].ProcYmd, "yyyyMMdd", null);

                            //문서 취소
                            DIresult = cancelDoc.Add();

                            //오브젝트 초기화
                            if (oODLN != null)
                            {
                                Marshal.ReleaseComObject(cancelDoc);
                                Marshal.ReleaseComObject(oODLN);
                                oODLN = null;
                            }

                            reader.Close();

                            //DI 문서 오류 처리
                            if (DIresult != 0)
                            {
                                if (jCVA003.BizSeq == 1)
                                {
                                    ResultList.Add(new ResultListItem
                                    {
                                        IfKey = jCVA003.ReqList[i].IfKey,
                                        ProcBundleNo = jCVA003.ReqList[i].ProcBundleNo,
                                        Result = "E",
                                        Message = $"DI Error: ${MACRO_company.GetLastErrorCode()} - ${MACRO_company.GetLastErrorDescription()}"
                                    });
                                    //throw new Exception($"DI Error: ${MACRO_company.GetLastErrorCode()} - ${MACRO_company.GetLastErrorDescription()}");
                                }
                                else
                                {
                                    ResultList.Add(new ResultListItem
                                    {
                                        IfKey = jCVA003.ReqList[i].IfKey,
                                        ProcBundleNo = jCVA003.ReqList[i].ProcBundleNo,
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
                                    IfKey = jCVA003.ReqList[i].IfKey,
                                    ProcBundleNo = jCVA003.ReqList[i].ProcBundleNo,
                                    Result = "S",
                                    Message = "처리 완료"
                                });
                            }
                            i++;
                        }
                        else if (jCVA003H.ErpReqTypCd == "OWTQ" && jCVA003.ReqList[i].EtcOutbizTypeCd == "") //입고유형이 없으면 입고PO
                        {
                            if (jCVA003.BizSeq == 1)
                            {
                                oOWTR = (StockTransfer)MACRO_company.GetBusinessObject(BoObjectTypes.oStockTransfer);
                            }
                            else
                            {
                                oOWTR = (StockTransfer)SJ_company.GetBusinessObject(BoObjectTypes.oStockTransfer);
                            }

                            //구매오더 기준 입고문서 조회
                            query = " SELECT DocEntry FROM " + sDB.SAPDB(jCVA003.BizSeq.ToString()) + "..OWTR ";
                            query = query + " Where U_WMSDOCNUM = '" + jCVA003.ReqList[i].WmsReqNo + "'";
                            query = query + "   AND U_WMSNUM = '" + jCVA003.ReqList[i].ProcBundleNo + "'";
                            _logger.LogWarning(query);

                            //쿼리 실행
                            command = new SqlCommand(query, connection);
                            reader = command.ExecuteReader();
                            reader.Read();

                            //헤더
                            oOWTR.GetByKey(int.Parse(reader.GetInt32(0).ToString()));

                            //문서 취소
                            DIresult = oOWTR.Cancel();

                            //오브젝트 초기화
                            if (oOWTR != null)
                            {
                                Marshal.ReleaseComObject(oOWTR);
                                oOWTR = null;
                            }

                            reader.Close();

                            //DI 문서 오류 처리
                            if (DIresult != 0)
                            {
                                if (jCVA003.BizSeq == 1)
                                {
                                    ResultList.Add(new ResultListItem
                                    {
                                        IfKey = jCVA003.ReqList[i].IfKey,
                                        ProcBundleNo = jCVA003.ReqList[i].ProcBundleNo,
                                        Result = "E",
                                        Message = $"DI Error: ${MACRO_company.GetLastErrorCode()} - ${MACRO_company.GetLastErrorDescription()}"
                                    });
                                    //throw new Exception($"DI Error: ${MACRO_company.GetLastErrorCode()} - ${MACRO_company.GetLastErrorDescription()}");
                                }
                                else
                                {
                                    ResultList.Add(new ResultListItem
                                    {
                                        IfKey = jCVA003.ReqList[i].IfKey,
                                        ProcBundleNo = jCVA003.ReqList[i].ProcBundleNo,
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
                                    IfKey = jCVA003.ReqList[i].IfKey,
                                    ProcBundleNo = jCVA003.ReqList[i].ProcBundleNo,
                                    Result = "S",
                                    Message = "처리 완료"
                                });
                            }
                            i++;
                        }
                        else //기타입고 기타출고 문서의 데이터를 읽어서 기타입고문서 처리
                        {
                            if (jCVA003.BizSeq == 1)
                            {
                                oOIGN = (Documents)MACRO_company.GetBusinessObject(BoObjectTypes.oInventoryGenEntry);
                                oOIGE = (Documents)MACRO_company.GetBusinessObject(BoObjectTypes.oInventoryGenExit);
                            }
                            else
                            {
                                oOIGN = (Documents)SJ_company.GetBusinessObject(BoObjectTypes.oInventoryGenEntry);
                                oOIGE = (Documents)SJ_company.GetBusinessObject(BoObjectTypes.oInventoryGenExit);
                            }

                            //기타입고 문서 생성
                            //헤더
                            oOIGN.DocDate = DateTime.ParseExact(jCVA003.ReqList[i].ProcYmd, "yyyyMMdd", null);
                            oOIGN.UserFields.Fields.Item("U_WMSDOCNUM").Value = jCVA003.ReqList[i].WmsReqNo;
                            oOIGN.UserFields.Fields.Item("U_WMSNUM").Value = jCVA003H.ProcBundleNo;
                            oOIGN.UserFields.Fields.Item("U_SAPNUM").Value = jCVA003H.ErpReqNo; //250410 수정

                            foreach (var jCVA003L in jCVA003.ReqList[i].ProdList)
                            {
                                if ((jCVA003L.ErpLineNo) != chk)
                                {
                                    if (j != 0)
                                    {
                                        oOIGN.Lines.Add();
                                        QTYSUM = 0;
                                    }
                                }

                                //기타입출고 계정 조회
                                query = " SELECT ZSM108L.U_AcctCode,OITM.AvgPrice ";
                                query = query + " From " + sDB.SAPDB(jCVA003.BizSeq.ToString()) + "..[@ZSM108H] ZSM108H";
                                query = query + " LEFT JOIN " + sDB.SAPDB(jCVA003.BizSeq.ToString()) + "..[@ZSM108L] ZSM108L ON ZSM108H.Code = ZSM108L.Code";
                                query = query + " LEFT JOIN " + sDB.SAPDB(jCVA003.BizSeq.ToString()) + "..[OITB] OITB ON OITB.ItmsGrpCod = ZSM108L.U_ItemGCod";
                                query = query + " LEFT JOIN " + sDB.SAPDB(jCVA003.BizSeq.ToString()) + "..[OITM] OITM ON OITM.ItemCode = '" + jCVA003L.IfProdId + "' AND OITM.ItmsGrpCod = ZSM108L.U_ItemGCod";
                                query = query + " Where ZSM108H.Code = '" + jCVA003.ReqList[i].EtcOutbizTypeCd + "'";
                                _logger.LogWarning(query);

                                //쿼리 실행
                                command = new SqlCommand(query, connection);
                                reader = command.ExecuteReader();
                                reader.Read();

                                //oOIGN.Lines.LineNum = oOIGE.Lines.LineNum;
                                oOIGN.Lines.ItemCode = jCVA003L.IfProdId; //품목코드
                                QTYSUM = QTYSUM + jCVA003L.ExQty;
                                oOIGN.Lines.InventoryQuantity = QTYSUM; //수량
                                oOIGN.Lines.UoMEntry = 1; //수량(EA : UOM)
                                oOIGN.Lines.AccountCode = reader.GetString(0); //기타입출고계정
                                oOIGN.Lines.UserFields.Fields.Item("U_LineType").Value = jCVA003.ReqList[i].EtcOutbizTypeCd;
                                reader.Close();

                                //원천(입고)에서 창고코드 조회 //250410 수정
                                query = " SELECT T1.WhsCode FROM " + sDB.SAPDB(jCVA003.BizSeq.ToString()) + "..OIGE T0 ";
                                query = query + " INNER JOIN " + sDB.SAPDB(jCVA003.BizSeq.ToString()) + "..IGE1 T1 ON T0.DocEntry = T1.DocEntry";
                                query = query + " WHERE U_WMSNUM = '" + jCVA003H.ProcBundleNo + "' AND U_WMSDOCNUM = '" + jCVA003.ReqList[i].WmsReqNo + "' AND T1.ItemCode = '" + jCVA003L.IfProdId + "' ";

                                //쿼리 실행 //250410 수정
                                command = new SqlCommand(query, connection);
                                reader = command.ExecuteReader();
                                reader.Read();
                                oOIGN.Lines.WarehouseCode = reader.GetString(0); ;
                                reader.Close();

                                chk = (jCVA003L.ErpLineNo);

                                //배치
                                oOIGN.Lines.BatchNumbers.BatchNumber = jCVA003L.ErpBatchNo; //배치번호
                                oOIGN.Lines.BatchNumbers.Quantity = jCVA003L.ExQty;
                                oOIGN.Lines.BatchNumbers.Add();
                                j++;
                            }

                            //문서 추가
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
                                if (jCVA003.BizSeq == 1)
                                {
                                    ResultList.Add(new ResultListItem
                                    {
                                        IfKey = jCVA003.ReqList[i].IfKey,
                                        ProcBundleNo = jCVA003.ReqList[i].ProcBundleNo,
                                        Result = "E",
                                        Message = $"DI Error: ${MACRO_company.GetLastErrorCode()} - ${MACRO_company.GetLastErrorDescription()}"
                                    });
                                    //throw new Exception($"DI Error: ${MACRO_company.GetLastErrorCode()} - ${MACRO_company.GetLastErrorDescription()}");
                                }
                                else
                                {
                                    ResultList.Add(new ResultListItem
                                    {
                                        IfKey = jCVA003.ReqList[i].IfKey,
                                        ProcBundleNo = jCVA003.ReqList[i].ProcBundleNo,
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
                                    IfKey = jCVA003.ReqList[i].IfKey,
                                    ProcBundleNo = jCVA003.ReqList[i].ProcBundleNo,
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