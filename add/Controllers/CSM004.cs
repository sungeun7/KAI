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
using System.Reflection.Metadata;
using System.Security.Authentication.ExtendedProtection;

/* [예외출고처리취소]
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

    public class CSM004Controller : ControllerBase
    {
        public class ApplicationDbContext : DbContext
        {
            public ApplicationDbContext(DbContextOptions<ApplicationDbContext> options) : base(options) { }
        }

        private readonly IConfiguration _configuration;
        private readonly ILogger<CSM004Controller> _logger;

        Dictionary<string, double> itemQuantities = new Dictionary<string, double>();

        bool isNewLine = false;

        // SAP 관련 기본 변수
        private readonly DIAPI _sapDIAPI;
        private int DIresult;

        //사용자변수
        private string oDocDate = "";

        public CSM004Controller(ILogger<CSM004Controller> logger, IConfiguration configuration, DIAPI sapDIAPI)
        {
            _logger = logger;
            _configuration = configuration;
            _sapDIAPI = sapDIAPI;
        }

        /// <summary>
        /// 예외출고처리취소
        /// </summary>
        [HttpPost(Name = "CSM004")]

        public IActionResult GetItem([FromBody] CSM004 jCSM004)
        {
            _logger.LogWarning(jCSM004.ToString());

            // 객체를 JSON 문자열로 변환
            string jsonString = JsonSerializer.Serialize(jCSM004);

            _logger.LogWarning(jsonString);

            List<cResult> cResult = new List<cResult>();

            //SAP DI Connect
            Company MACRO_company = _sapDIAPI.Get_MACRO_Company();
            Company SJ_company = _sapDIAPI.Get_SJ_Company();
            string connectionString = _configuration.GetConnectionString("DefaultConnection");
            string query = "";
            Documents oORPD = null;
            Documents oOIGN = null;
            Documents cancelDoc = null;
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
                if (jCSM004.APIKEY != "emdc")
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

                if (jCSM004.BizSeq == 1)
                {
                    query = "UPDATE " + sDB.SAPDB(jCSM004.BizSeq.ToString()) + "..OPRR SET U_WMSNY = 'N' WHERE DocEntry = '" + jCSM004.ReqList[i].ErpReqNo + "'";
                }
                else if (jCSM004.BizSeq == 2)
                {
                    query = "UPDATE " + sDB.SAPDB(jCSM004.BizSeq.ToString()) + "..OPRR SET U_WMSNY = 'N' WHERE DocEntry = '" + jCSM004.ReqList[i].ErpReqNo + "'";
                }

                //중복된 행 제거
                var distinctReqList = jCSM004.ReqList
                .GroupBy(x => x.ProcBundleNo)
                .Select(g => g.First())
                .ToList();

                //SQL 쿼리문 작성부분
                foreach (var jCSM004H in distinctReqList)
                {
                    try
                    {
                        ReIfKey = jCSM004H.IfKey;
                        ReProcBundleNo = jCSM004H.ProcBundleNo;

                        if (string.IsNullOrEmpty(jCSM004H.ErpReqNo))
                        {
                            jCSM004H.ErpReqNo = ""; // null 또는 빈 문자열인 경우 빈 문자열로 설정
                        }

                        if (jCSM004.ReqList[i].EtcTypeCd == "EX95")
                        {
                            if (jCSM004.BizSeq == 1)
                            {
                                oORPD = (Documents)MACRO_company.GetBusinessObject(BoObjectTypes.oPurchaseReturns);
                            }
                            else
                            {
                                oORPD = (Documents)SJ_company.GetBusinessObject(BoObjectTypes.oPurchaseReturns);
                            }

                            //구매오더 기준 입고문서 조회
                            query = " SELECT DocEntry FROM " + sDB.SAPDB(jCSM004.BizSeq.ToString()) + "..ORPD ";
                            query = query + " Where U_WMSDOCNUM = '" + jCSM004.ReqList[i].WmsReqNo + "'";
                            query = query + "   AND U_WMSNUM = '" + jCSM004.ReqList[i].ProcBundleNo + "'";
                            _logger.LogWarning(query);

                            //쿼리 실행
                            command = new SqlCommand(query, connection);
                            reader = command.ExecuteReader();
                            reader.Read();

                            //헤더
                            oORPD.GetByKey(int.Parse(reader.GetInt32(0).ToString()));
                            cancelDoc = oORPD.CreateCancellationDocument();
                            cancelDoc.DocDate = DateTime.ParseExact(jCSM004.ReqList[i].ProcYmd, "yyyyMMdd", null);

                            //문서 취소
                            DIresult = cancelDoc.Add();

                            //오브젝트 초기화
                            if (oORPD != null)
                            {
                                Marshal.ReleaseComObject(cancelDoc);
                                Marshal.ReleaseComObject(oORPD);
                                oORPD = null;
                            }

                            reader.Close();

                            //DI 문서 오류 처리
                            if (DIresult != 0)
                            {
                                if (jCSM004.BizSeq == 1)
                                {
                                    ResultList.Add(new ResultListItem
                                    {
                                        IfKey = jCSM004.ReqList[i].IfKey,
                                        ProcBundleNo = jCSM004.ReqList[i].ProcBundleNo,
                                        Result = "E",
                                        Message = $"DI Error: ${MACRO_company.GetLastErrorCode()} - ${MACRO_company.GetLastErrorDescription()}"
                                    });
                                    //throw new Exception($"DI Error: ${MACRO_company.GetLastErrorCode()} - ${MACRO_company.GetLastErrorDescription()}");
                                }
                                else
                                {
                                    ResultList.Add(new ResultListItem
                                    {
                                        IfKey = jCSM004.ReqList[i].IfKey,
                                        ProcBundleNo = jCSM004.ReqList[i].ProcBundleNo,
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
                                    IfKey = jCSM004.ReqList[i].IfKey,
                                    ProcBundleNo = jCSM004.ReqList[i].ProcBundleNo,
                                    Result = "S",
                                    Message = "처리 완료"
                                });
                            }
                            i++;
                        }
                        else
                        {
                            if (jCSM004.BizSeq == 1)
                            {
                                oOIGN = (Documents)MACRO_company.GetBusinessObject(BoObjectTypes.oInventoryGenEntry);
                            }
                            else
                            {
                                oOIGN = (Documents)SJ_company.GetBusinessObject(BoObjectTypes.oInventoryGenEntry);
                            }

                            //본문
                            foreach (var jCSM004L in jCSM004.ReqList[i].ProdList)
                            {
                                if ((jCSM004L.ErpLineNo) != chk)
                                {
                                    if (j != 0)
                                    {
                                        oOIGN.Lines.Add();
                                        QTYSUM = 0;
                                    }
                                }

                                //헤더
                                oOIGN.DocDate = DateTime.ParseExact(jCSM004H.ProcYmd, "yyyyMMdd", null); //전기일
                                oOIGN.UserFields.Fields.Item("U_WMSDOCNUM").Value = jCSM004.ReqList[i].WmsReqNo;
                                oOIGN.UserFields.Fields.Item("U_WMSNUM").Value = jCSM004H.ProcBundleNo;
                                //oOIGN.Comments = "";

                                //라인
                                //기타입출고 계정 조회
                                query = " SELECT ZSM108L.U_AcctCode,OITM.AvgPrice ";
                                query = query + " From " + sDB.SAPDB(jCSM004.BizSeq.ToString()) + "..[@ZSM108H] ZSM108H";
                                query = query + " LEFT JOIN " + sDB.SAPDB(jCSM004.BizSeq.ToString()) + "..[@ZSM108L] ZSM108L ON ZSM108H.Code = ZSM108L.Code";
                                query = query + " LEFT JOIN " + sDB.SAPDB(jCSM004.BizSeq.ToString()) + "..[OITB] OITB ON OITB.ItmsGrpCod = ZSM108L.U_ItemGCod";
                                query = query + " LEFT JOIN " + sDB.SAPDB(jCSM004.BizSeq.ToString()) + "..[OITM] OITM ON OITM.ItemCode = '" + jCSM004L.IfProdId + "' AND OITM.ItmsGrpCod = ZSM108L.U_ItemGCod";
                                query = query + " Where ZSM108H.Code = '" + jCSM004.ReqList[i].EtcTypeCd + "'";
                                _logger.LogWarning(query);

                                //쿼리 실행
                                command = new SqlCommand(query, connection);
                                reader = command.ExecuteReader();
                                reader.Read();

                                if (jCSM004.ReqList[i].EtcTypeCd != "I-201") //소분입고가 아닐때만 이동평균처리
                                {
                                    var Price = reader.GetValue(1);
                                    oOIGN.Lines.UnitPrice = double.Parse(Price.ToString()); //이동평균처리
                                }

                                oOIGN.Lines.ItemCode = jCSM004L.IfProdId;
                                QTYSUM = QTYSUM + jCSM004L.ExQty;
                                oOIGN.Lines.InventoryQuantity = QTYSUM;
                                oOIGN.Lines.AccountCode = reader.GetString(0); //기타입출고계정
                                //oOIGN.Lines.UoMEntry = 1; //수량(EA : UOM)
                                oOIGN.Lines.WarehouseCode = jCSM004L.FrWh;
                                oOIGN.Lines.UserFields.Fields.Item("U_LineType").Value = jCSM004.ReqList[i].EtcTypeCd;

                                chk = (jCSM004L.ErpLineNo);

                                //배치
                                oOIGN.Lines.BatchNumbers.ExpiryDate = DateTime.ParseExact(jCSM004L.ExpYmd, "yyyyMMdd", null);
                                oOIGN.Lines.BatchNumbers.Quantity = jCSM004L.ExQty;
                                oOIGN.Lines.BatchNumbers.BatchNumber = jCSM004L.ErpBatchNo; //jCSM004L.oITEMCODE + '@' + jCSM004L.oEXPDATE;
                                oOIGN.Lines.BatchNumbers.Add();

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
                                if (jCSM004.BizSeq == 1)
                                {
                                    ResultList.Add(new ResultListItem
                                    {
                                        IfKey = jCSM004.ReqList[i].IfKey,
                                        ProcBundleNo = jCSM004.ReqList[i].ProcBundleNo,
                                        Result = "E",
                                        Message = $"DI Error: ${MACRO_company.GetLastErrorCode()} - ${MACRO_company.GetLastErrorDescription()}"
                                    });
                                    //throw new Exception($"DI Error: ${MACRO_company.GetLastErrorCode()} - ${MACRO_company.GetLastErrorDescription()}");
                                }
                                else
                                {
                                    ResultList.Add(new ResultListItem
                                    {
                                        IfKey = jCSM004.ReqList[i].IfKey,
                                        ProcBundleNo = jCSM004.ReqList[i].ProcBundleNo,
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
                                    IfKey = jCSM004.ReqList[i].IfKey,
                                    ProcBundleNo = jCSM004.ReqList[i].ProcBundleNo,
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