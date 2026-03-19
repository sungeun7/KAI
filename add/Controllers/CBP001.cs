using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Data.SqlClient;
using MACRO_WMS.Models;
using System.Reflection.PortableExecutable;
using System.Text.Json;
using Microsoft.Identity.Client;
using Microsoft.AspNetCore.Http;
using SAPbobsCOM;
using System.Drawing;
using System.Runtime.InteropServices;
using MACRO_WMS.SAP;

/* [입고예정취소]
 * 샘플
{
  "apikey": "emdc",
  "bizSeq": "1",
  "reqList": [
    {
      "ifKey": "IW202410250002",
      "inwhTypeCd": "IW91",
      "erpReqNo": "IW202410250002"
    },
    {
      "ifKey": "IW202410250002",
      "inwhTypeCd": "IW91",
      "erpReqNo": "3"
    }
  ]
}
*/

namespace MACRO_WMS.Controllers
{
    [ApiController]
    [Route("[controller]")]

    public class CBP001Controller : ControllerBase
    {
        public class ApplicationDbContext : DbContext
        {
            public ApplicationDbContext(DbContextOptions<ApplicationDbContext> options) : base(options) { }
        }

        private readonly IConfiguration _configuration;
        private readonly ILogger<CBP001Controller> _logger;

        private readonly DIAPI _sapDIAPI;
        private int DIresult;

        public CBP001Controller(ILogger<CBP001Controller> logger, IConfiguration configuration, DIAPI sapDIAPI)
        {
            _logger = logger;
            _configuration = configuration;
            _sapDIAPI = sapDIAPI;
        }
        
        /// <summary>
        /// 입고예정취소
        /// </summary>
        [HttpPost(Name = "CBP001")]
        public IActionResult GetItem([FromBody] CBP001 jCBP001)
        {
            _logger.LogWarning(jCBP001.ToString());

            // 객체를 JSON 문자열로 변환
            string jsonString = JsonSerializer.Serialize(jCBP001);

            _logger.LogWarning(jsonString);

            List<cResult> cResult = new List<cResult>();
            List<ResultListItem> ResultList = new List<ResultListItem>();

            string connectionString = _configuration.GetConnectionString("DefaultConnection");
            string query = "";
            Company MACRO_company = _sapDIAPI.Get_MACRO_Company();
            Company SJ_company = _sapDIAPI.Get_SJ_Company();
            Documents oOPOR = null;
            SqlCommand command;
            SqlDataReader reader;
            SAP.SAP sDB = new SAP.SAP();

            int i = 0;
            string ReIfKey = "";
            string ReProcBundleNo = "";

            /*
            cResult Result = new cResult
            {
                oStatus = "",
                oResultData = "",
                oErrData = ""
            };
            cResult.Add(Result);
           
            
            cResult Result = new cResult
            {
                HttpResult = "",
                HttpMessage = ""
            };
            ResultListItem ResultList = new ResultListItem()
            {
                IfKey = "",
                Result = "",
                Message = ""
            };
            cResult.Add(Result);
            Result.ResultList.Add(ResultList);
             */

            using (SqlConnection connection = new SqlConnection(connectionString))
            {   
                //DB 연결
                connection.Open();

                //API KEY 체크(최소한의 보안)
                if (jCBP001.APIKEY != "emdc")
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
                        //oStatus = "S",  // S:성공, E:실패
                        //oResultData = "Success", // Success:성공 그외 오류시 코드 전송
                        //oErrData = "" //오류 메시지 값 리턴
                        ResultList = ResultList
                    };

                    return Ok(API_result);
                    //throw new Exception("API KEY Error");
                }

                //SQL 쿼리문 작성부분
                foreach (var jCBP001H in jCBP001.ReqList)
                {
                    try
                    {
                        ReIfKey = jCBP001H.IfKey;
                        ReProcBundleNo = jCBP001H.ProcBundleNo;

                        if (jCBP001.BizSeq == 1)
                        {
                            if (jCBP001.ReqList[i].InwhTypeCd == "IW01")
                            {
                                query = "UPDATE " + sDB.SAPDB(jCBP001.BizSeq.ToString()) + "..OPOR SET U_WMSNY = 'C' WHERE DocEntry = '" + jCBP001.ReqList[i].ErpReqNo + "'";
                                oOPOR = (Documents)MACRO_company.GetBusinessObject(BoObjectTypes.oPurchaseOrders);
                            }
                            else
                            {
                                query = "UPDATE " + sDB.SAPDB(jCBP001.BizSeq.ToString()) + "..OPDN SET U_WMSNY = 'N' WHERE DocEntry = '" + jCBP001.ReqList[i].ErpReqNo + "'";
                            }
                        }
                        else if (jCBP001.BizSeq == 2)
                        {
                            if (jCBP001.ReqList[i].InwhTypeCd == "IW01")
                            {
                                query = "UPDATE " + sDB.SAPDB(jCBP001.BizSeq.ToString()) + "..OPOR SET U_WMSNY = 'C' WHERE DocEntry = '" + jCBP001.ReqList[i].ErpReqNo + "'";
                                oOPOR = (Documents)SJ_company.GetBusinessObject(BoObjectTypes.oPurchaseOrders);
                            }
                            else
                            {
                                query = "UPDATE " + sDB.SAPDB(jCBP001.BizSeq.ToString()) + "..OPDN SET U_WMSNY = 'N' WHERE DocEntry = '" + jCBP001.ReqList[i].ErpReqNo + "'";
                            }
                        }

                        command = new SqlCommand(query, connection);
                        _logger.LogInformation(query);

                        //쿼리 실행
                        reader = command.ExecuteReader();
                        reader.Close();

                        //헤더
                        oOPOR.GetByKey(int.Parse(jCBP001.ReqList[i].ErpReqNo));
                        oOPOR.Close();

                        // 오브젝트 초기화
                        if (oOPOR != null)
                        {
                            Marshal.ReleaseComObject(oOPOR);
                            oOPOR = null;
                        }

                        //DI 문서 오류 처리
                        if (DIresult != 0)
                        {
                            if (jCBP001.BizSeq == 1)
                            {
                                ResultList.Add(new ResultListItem
                                {
                                    IfKey = jCBP001.ReqList[i].IfKey,
                                    ProcBundleNo = jCBP001.ReqList[i].ProcBundleNo,
                                    Result = "E",
                                    Message = $"DI Error: ${MACRO_company.GetLastErrorCode()} - ${MACRO_company.GetLastErrorDescription()}"
                                });
                                //throw new Exception($"DI Error: ${MACRO_company.GetLastErrorCode()} - ${MACRO_company.GetLastErrorDescription()}");
                            }
                            else
                            {
                                ResultList.Add(new ResultListItem
                                {
                                    IfKey = jCBP001.ReqList[i].IfKey,
                                    ProcBundleNo = jCBP001.ReqList[i].ProcBundleNo,
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
                                IfKey = jCBP001.ReqList[i].IfKey,
                                ProcBundleNo = jCBP001.ReqList[i].ProcBundleNo,
                                Result = "S",
                                Message = "처리 완료"
                            });
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

                        //public async Task ExampleUsage()
                        //{
                        //    string url = "http;//192.168.0.37/CBP001";
                        //    await new HttpHelper().SendRequestAsync(url);
                        //}

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
                    //oStatus = "S",  // S:성공, E:실패
                    //oResultData = "Success", // Success:성공 그외 오류시 코드 전송
                    //oErrData = "" //오류 메시지 값 리턴
                    ResultList = ResultList
                };

                string ResultListString = string.Join(",", ResultList.Select(item =>
                    $"IfKey: {item.IfKey}, ProcBundleNo: {item.ProcBundleNo}, Result: {item.Result}, Message: {item.Message}"));
                string resultString = $"HttpResult: {result.HttpResult}, HttpMessage: {result.HttpMessage}, Results: [{ResultListString}]";
                _logger.LogWarning(resultString);

                //DB연결 종료
                connection.Close();

                if (oOPOR != null)
                {
                    Marshal.ReleaseComObject(oOPOR);
                    oOPOR = null;
                }

                return Ok(result);
            }
        }
    }
}