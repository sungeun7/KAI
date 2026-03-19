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

/* [출하처리 강제확정]
 * 샘플
{
  "apikey": "emdc",
  "bizSeq": "1",
  "reqList": [
    {
      "ifKey": "8841",
      "outbizTypeCd": "",
      "centerSeq": "",      
      "wmsReqNo": "8841",
      "erpReqTypCd": "",      
      "erpReqNo": "13078",
      "erpPickingNo": "",
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

    public class CVA004Controller : ControllerBase
    {
        public class ApplicationDbContext : DbContext
        {
            public ApplicationDbContext(DbContextOptions<ApplicationDbContext> options) : base(options) { }
        }

        private readonly IConfiguration _configuration;
        private readonly ILogger<CVA004Controller> _logger;

        // SAP 관련 기본 변수
        private readonly DIAPI _sapDIAPI;
        private int DIresult;

        //사용자변수
        private string oDocDate = "";

        public CVA004Controller(ILogger<CVA004Controller> logger, IConfiguration configuration, DIAPI sapDIAPI)
        {
            _logger = logger;
            _configuration = configuration;
            _sapDIAPI = sapDIAPI; 
        }

        /// <summary>
        /// 출하처리 강제확정
        /// </summary>
        [HttpPost(Name = "CVA004")]
        public IActionResult GetItem([FromBody] CVA004 jCVA004)
        {
            _logger.LogWarning(jCVA004.ToString());

            // 객체를 JSON 문자열로 변환
            string jsonString = JsonSerializer.Serialize(jCVA004);

            _logger.LogWarning(jsonString);

            List<cResult> cResult = new List<cResult>();

            string connectionString = _configuration.GetConnectionString("DefaultConnection");
            string query = "";
            SqlCommand command;
            SqlDataReader reader;
            SAP.SAP sDB = new SAP.SAP();

            //SAP DI Connect
            Company MACRO_company = _sapDIAPI.Get_MACRO_Company();
            Company SJ_company = _sapDIAPI.Get_SJ_Company();
            Documents oORDR = null;
            StockTransfer oOWTQ = null;

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
                if (jCVA004.APIKEY != "emdc")
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
                var distinctReqList = jCVA004.ReqList
                .GroupBy(x => x.ErpReqNo)
                .Select(g => g.First())
                .ToList();

                //SQL 쿼리문 작성부분
                foreach (var jCVA004H in distinctReqList)
                {
                    try
                    {
                        ReIfKey = jCVA004H.IfKey;
                        ReProcBundleNo = jCVA004H.ProcBundleNo;

                        if (jCVA004H.ErpReqTypCd == "ORDR")
                        {
                            if (jCVA004.BizSeq == 1)
                            {
                                oORDR = (Documents)MACRO_company.GetBusinessObject(BoObjectTypes.oOrders);
                            }
                            else
                            {
                                oORDR = (Documents)SJ_company.GetBusinessObject(BoObjectTypes.oOrders);
                            }

                            //헤더
                            oORDR.GetByKey(int.Parse(jCVA004.ReqList[i].ErpReqNo));
                            oORDR.Close();

                            //오브젝트 초기화
                            Marshal.ReleaseComObject(oORDR);
                            oORDR = null;

                            //DI 문서 오류 처리
                            if (DIresult != 0)
                            {
                                if (jCVA004.BizSeq == 1)
                                {
                                    ResultList.Add(new ResultListItem
                                    {
                                        IfKey = jCVA004.ReqList[i].IfKey,
                                        ProcBundleNo = jCVA004.ReqList[i].ProcBundleNo,
                                        Result = "E",
                                        Message = $"DI Error: ${MACRO_company.GetLastErrorCode()} - ${MACRO_company.GetLastErrorDescription()}"
                                    });
                                    //throw new Exception($"DI Error: ${MACRO_company.GetLastErrorCode()} - ${MACRO_company.GetLastErrorDescription()}");
                                }
                                else
                                {
                                    ResultList.Add(new ResultListItem
                                    {
                                        IfKey = jCVA004.ReqList[i].IfKey,
                                        ProcBundleNo = jCVA004.ReqList[i].ProcBundleNo,
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
                                    IfKey = jCVA004.ReqList[i].IfKey,
                                    ProcBundleNo = jCVA004.ReqList[i].ProcBundleNo,
                                    Result = "S",
                                    Message = "처리 완료"
                                });
                            }
                        }
                        else
                        {
                            if (jCVA004.BizSeq == 1)
                            {
                                oOWTQ = (StockTransfer)MACRO_company.GetBusinessObject(BoObjectTypes.oInventoryTransferRequest);
                            }
                            else
                            {
                                oOWTQ = (StockTransfer)SJ_company.GetBusinessObject(BoObjectTypes.oInventoryTransferRequest);
                            }

                            //헤더
                            oOWTQ.GetByKey(int.Parse(jCVA004.ReqList[i].ErpReqNo));
                            oOWTQ.Close();

                            //오브젝트 초기화
                            Marshal.ReleaseComObject(oOWTQ);
                            oOWTQ = null;

                            //DI 문서 오류 처리
                            if (DIresult != 0)
                            {
                                if (jCVA004.BizSeq == 1)
                                {
                                    ResultList.Add(new ResultListItem
                                    {
                                        IfKey = jCVA004.ReqList[i].IfKey,
                                        ProcBundleNo = jCVA004.ReqList[i].ProcBundleNo,
                                        Result = "E",
                                        Message = $"DI Error: ${MACRO_company.GetLastErrorCode()} - ${MACRO_company.GetLastErrorDescription()}"
                                    });
                                    //throw new Exception($"DI Error: ${MACRO_company.GetLastErrorCode()} - ${MACRO_company.GetLastErrorDescription()}");
                                }
                                else
                                {
                                    ResultList.Add(new ResultListItem
                                    {
                                        IfKey = jCVA004.ReqList[i].IfKey,
                                        ProcBundleNo = jCVA004.ReqList[i].ProcBundleNo,
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
                                    IfKey = jCVA004.ReqList[i].IfKey,
                                    ProcBundleNo = jCVA004.ReqList[i].ProcBundleNo,
                                    Result = "S",
                                    Message = "처리 완료"
                                });
                            };
                        }
                        i++;
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

                if (oORDR != null)
                {
                    Marshal.ReleaseComObject(oORDR);
                    oORDR = null;
                }
                if (oOWTQ != null)
                {
                    Marshal.ReleaseComObject(oOWTQ);
                    oOWTQ = null;
                }
                
                return Ok(result);
            }
        }
    }
}