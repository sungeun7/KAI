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
using System.Reflection.PortableExecutable;

/* [반품마감취소]
 * 샘플
{
  "apikey": "emdc",
  "bizSeq": "1",
  "reqList": [
    {
      "ifKey": "8841",
      "inwhTypeCd": "IW01",
      "centerSeq": "1",
      "wmsReqNo": "8841",
      "erpReqNo": "13078",
      "procYmd": "20240827",
      "procHms": "120000",
      "procUserId": "MCR001"
    }
  ]
}
*/

namespace MACRO_WMS.Controllers
{
    [ApiController]
    [Route("[controller]")]

    public class CBP007Controller : ControllerBase
    {
        public class ApplicationDbContext : DbContext
        {
            public ApplicationDbContext(DbContextOptions<ApplicationDbContext> options) : base(options) { }
        }

        private readonly IConfiguration _configuration;
        private readonly ILogger<CBP007Controller> _logger;

        // SAP 관련 기본 변수
        private readonly DIAPI _sapDIAPI;
        private int DIresult;
        SqlCommand command;
        SqlDataReader reader;

        //사용자변수
        private string oDocDate = "";

        public CBP007Controller(ILogger<CBP007Controller> logger, IConfiguration configuration, DIAPI sapDIAPI)
        {
            _logger = logger;
            _configuration = configuration;
            _sapDIAPI = sapDIAPI; 
        }

        /// <summary>
        /// 반품마감취소
        /// </summary>
        [HttpPost(Name = "CBP007")]
        public IActionResult GetItem([FromBody] CBP007 jCBP007)
        {
            _logger.LogWarning(jCBP007.ToString());

            // 객체를 JSON 문자열로 변환
            string jsonString = JsonSerializer.Serialize(jCBP007);

            _logger.LogWarning(jsonString);

            List<cResult> cResult = new List<cResult>();

            string connectionString = _configuration.GetConnectionString("DefaultConnection");
            string query = "";

            //SAP DI Connect
            Company MACRO_company = _sapDIAPI.Get_MACRO_Company();
            Company SJ_company = _sapDIAPI.Get_SJ_Company();
            Documents oORDN = null;
            StockTransfer oOWTR = null;
            Documents oORRR = null;
            StockTransfer oOWTQ = null;
            SAP.SAP sDB = new SAP.SAP();

            int i = 0;
            int j = 0;
            string ReIfKey = "";
            string ReProcBundleNo = "";

            List<ResultListItem> ResultList = new List<ResultListItem>();

            using (SqlConnection connection = new SqlConnection(connectionString))
            {   
                //DB 연결
                connection.Open();

                //API KEY 체크(최소한의 보안)
                if (jCBP007.APIKEY != "emdc")
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
                var distinctReqList = jCBP007.ReqList
                .GroupBy(x => x.ErpReqNo)
                .Select(g => g.First())
                .ToList();

                //SQL 쿼리문 작성부분
                foreach (var jCBP007H in distinctReqList)
                {
                    try
                    {
                        ReIfKey = jCBP007H.IfKey;
                        ReProcBundleNo = jCBP007H.ProcBundleNo;

                        if (jCBP007.BizSeq == 1)
                        {
                            query = "UPDATE " + sDB.SAPDB(jCBP007.BizSeq.ToString()) + "..ORRR SET U_WMSNY = 'N' WHERE DocEntry = '" + jCBP007.ReqList[i].ErpReqNo + "'";
                            //query = "UPDATE " + sDB.SAPDB(jCBP007.BizSeq.ToString()) + "..OWTQ SET U_WMSNY = 'C' WHERE DocEntry = '" + jCBP007.ReqList[i].ErpReqNo + "'";
                        }
                        else if (jCBP007.BizSeq == 2)
                        {
                            query = "UPDATE " + sDB.SAPDB(jCBP007.BizSeq.ToString()) + "..ORRR SET U_WMSNY = 'N' WHERE DocEntry = '" + jCBP007.ReqList[i].ErpReqNo + "'";
                            //query = "UPDATE " + sDB.SAPDB(jCBP007.BizSeq.ToString()) + "..OWTQ SET U_WMSNY = 'C' WHERE DocEntry = '" + jCBP007.ReqList[i].ErpReqNo + "'";
                        }

                        command = new SqlCommand(query, connection);
                        reader = command.ExecuteReader();
                        reader.Read();
                        reader.Close();

                        if (jCBP007H.InwhTypeCd == "RT01") //RT01 일반반품 RT03 매장반품
                        {
                            if (jCBP007.BizSeq == 1)
                            {
                                oORDN = (Documents)MACRO_company.GetBusinessObject(BoObjectTypes.oReturns);
                                oORRR = (Documents)MACRO_company.GetBusinessObject(BoObjectTypes.oReturnRequest);
                            }
                            else
                            {
                                oORDN = (Documents)SJ_company.GetBusinessObject(BoObjectTypes.oReturns);
                                oORRR = (Documents)SJ_company.GetBusinessObject(BoObjectTypes.oReturnRequest);
                            }
                            
                           //구매오더 기준 입고문서 조회
                           query = " SELECT DocEntry FROM " + sDB.SAPDB(jCBP007.BizSeq.ToString()) + "..ORDN ";
                            query = query + " Where U_WMSDOCNUM = '" + jCBP007.ReqList[i].WmsReqNo + "'";
                            _logger.LogWarning(query);

                            //쿼리 실행
                            command = new SqlCommand(query, connection);
                            reader = command.ExecuteReader();
                            reader.Read();

                            //헤더
                            oORDN.GetByKey(int.Parse(reader.GetInt32(0).ToString()));
                            Documents cancelDoc = oORDN.CreateCancellationDocument();
                            cancelDoc.DocDate = DateTime.ParseExact(jCBP007.ReqList[i].ProcYmd, "yyyyMMdd", null);

                            //문서 취소
                            DIresult = cancelDoc.Add();

                            if (DIresult == 0) //241213 추가
                            {
                                //문서 닫기
                                oORRR.GetByKey(int.Parse(jCBP007.ReqList[i].ErpReqNo));
                                DIresult = oORRR.Close();
                            }

                            //오브젝트 초기화
                            if (oORDN != null)
                            {
                                Marshal.ReleaseComObject(cancelDoc);
                                Marshal.ReleaseComObject(oORDN);
                                oORDN = null;
                            }

                            reader.Close();

                            //DI 문서 오류 처리
                            if (DIresult != 0)
                            {
                                if (jCBP007.BizSeq == 1)
                                {
                                    ResultList.Add(new ResultListItem
                                    {
                                        IfKey = jCBP007.ReqList[i].IfKey,
                                        ProcBundleNo = jCBP007.ReqList[i].ProcBundleNo,
                                        Result = "E",
                                        Message = $"DI Error: ${MACRO_company.GetLastErrorCode()} - ${MACRO_company.GetLastErrorDescription()}"
                                    });
                                    //throw new Exception($"DI Error: ${MACRO_company.GetLastErrorCode()} - ${MACRO_company.GetLastErrorDescription()}");
                                }
                                else
                                {
                                    ResultList.Add(new ResultListItem
                                    {
                                        IfKey = jCBP007.ReqList[i].IfKey,
                                        ProcBundleNo = jCBP007.ReqList[i].ProcBundleNo,
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
                                    IfKey = jCBP007.ReqList[i].IfKey,
                                    ProcBundleNo = jCBP007.ReqList[i].ProcBundleNo,
                                    Result = "S",
                                    Message = "처리 완료"
                                });
                            }
                            i++;
                        }
                        else
                        {
                            if (jCBP007.BizSeq == 1)
                            {
                                oOWTR = (StockTransfer)MACRO_company.GetBusinessObject(BoObjectTypes.oStockTransfer);
                                oOWTQ = (StockTransfer)MACRO_company.GetBusinessObject(BoObjectTypes.oInventoryTransferRequest);
                            }
                            else
                            {
                                oOWTR = (StockTransfer)SJ_company.GetBusinessObject(BoObjectTypes.oStockTransfer);
                                oOWTQ = (StockTransfer)SJ_company.GetBusinessObject(BoObjectTypes.oInventoryTransferRequest);
                            }
                           
                            //재고이전요청문서 조회 조회
                            query = " SELECT DocEntry FROM " + sDB.SAPDB(jCBP007.BizSeq.ToString()) + "..OWTR ";
                            query = query + " Where U_WMSDOCNUM = '" + jCBP007.ReqList[i].WmsReqNo + "'";
                            _logger.LogWarning(query);

                            //쿼리 실행
                            command = new SqlCommand(query, connection);
                            reader = command.ExecuteReader();
                            reader.Read();

                            //재고이전문서 취소
                            oOWTR.GetByKey(int.Parse(reader.GetInt32(0).ToString()));
                            DIresult = oOWTR.Cancel();

                            if (DIresult == 0) //241213 추가
                            {
                                //재고이전요청 문서 닫기
                                oOWTQ.GetByKey(int.Parse(jCBP007.ReqList[i].ErpReqNo));
                                oOWTQ.Close();
                            }

                            //오브젝트 초기화
                            if (oOWTR != null)
                            {
                                Marshal.ReleaseComObject(oOWTQ);
                                oOWTR = null;
                                oOWTQ = null;
                            }

                            reader.Close();

                            //DI 문서 오류 처리
                            if (DIresult != 0)
                            {
                                if (jCBP007.BizSeq == 1)
                                {
                                    ResultList.Add(new ResultListItem
                                    {
                                        IfKey = jCBP007.ReqList[i].IfKey,
                                        ProcBundleNo = jCBP007.ReqList[i].ProcBundleNo,
                                        Result = "E",
                                        Message = $"DI Error: ${MACRO_company.GetLastErrorCode()} - ${MACRO_company.GetLastErrorDescription()}"
                                    });
                                    //throw new Exception($"DI Error: ${MACRO_company.GetLastErrorCode()} - ${MACRO_company.GetLastErrorDescription()}");
                                }
                                else
                                {
                                    ResultList.Add(new ResultListItem
                                    {
                                        IfKey = jCBP007.ReqList[i].IfKey,
                                        ProcBundleNo = jCBP007.ReqList[i].ProcBundleNo,
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
                                    IfKey = jCBP007.ReqList[i].IfKey,
                                    ProcBundleNo = jCBP007.ReqList[i].ProcBundleNo,
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

                if (oORDN != null)
                {
                    Marshal.ReleaseComObject(oORDN);
                }
                oORDN = null;
                if (oOWTR != null)
                {
                    Marshal.ReleaseComObject(oOWTR);
                }
                oOWTR = null;

                return Ok(result);
            }
        }
    }
}