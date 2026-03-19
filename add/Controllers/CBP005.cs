using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Data.SqlClient;
using MACRO_WMS.Models;
using System.Reflection.PortableExecutable;
using System.Text.Json;
using SAPbobsCOM;
using Microsoft.AspNetCore.Http;
using System.Runtime.InteropServices;
using MACRO_WMS.SAP;
using System.Drawing;

/* [반품예정취소]
 * 샘플
{
  "apikey": "emdc",
  "bizSeq": "1",
  "reqList": [
    {
      "ifKey": "8841",
      "returnTypeCd": "1",
      "erpReqNo": "8841"
    },
    {
      "ifKey": "8841",
      "returnTypeCd": "1",
      "erpReqNo": "8842"
    }
  ]
}
*/

namespace MACRO_WMS.Controllers
{
    [ApiController]
    [Route("[controller]")]

    public class CBP005Controller : ControllerBase
    {
        public class ApplicationDbContext : DbContext
        {
            public ApplicationDbContext(DbContextOptions<ApplicationDbContext> options) : base(options) { }
        }

        private readonly IConfiguration _configuration;
        private readonly ILogger<CBP005Controller> _logger;

        // SAP 관련 기본 변수
        private readonly DIAPI _sapDIAPI;
        private int DIresult;

        public CBP005Controller(ILogger<CBP005Controller> logger, IConfiguration configuration, DIAPI sapDIAPI)
        {
            _logger = logger;
            _configuration = configuration;
            _sapDIAPI = sapDIAPI;
        }
        
        /// <summary>
        /// 반품예정취소
        /// </summary>
        [HttpPost(Name = "CBP005")]
        public IActionResult GetItem([FromBody] CBP005 jCBP005)
        {
            _logger.LogWarning(jCBP005.ToString());

            // 객체를 JSON 문자열로 변환
            string jsonString = JsonSerializer.Serialize(jCBP005);

            _logger.LogWarning(jsonString);

            List<cResult> cResult = new List<cResult>();

            string connectionString = _configuration.GetConnectionString("DefaultConnection");
            string query = "";
            SqlCommand command;
            SqlDataReader reader;
            Company MACRO_company = _sapDIAPI.Get_MACRO_Company();
            Company SJ_company = _sapDIAPI.Get_SJ_Company();
            Documents oORRR = null;
            StockTransfer oOWTQ = null;
            Documents cancelDoc = null;
            SAP.SAP sDB = new SAP.SAP();

            int i = 0;
            string ReIfKey = "";
            string ReProcBundleNo = "";

            List<ResultListItem> ResultList = new List<ResultListItem>();

            using (SqlConnection connection = new SqlConnection(connectionString))
            {
                //DB 연결
                connection.Open();

                //API KEY 체크(최소한의 보안)
                if (jCBP005.APIKEY != "emdc")
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
                foreach (var jCBP005H in jCBP005.ReqList)
                {
                    try
                    {
                        ReIfKey = jCBP005H.IfKey;
                        ReProcBundleNo = jCBP005H.ProcBundleNo;

                        if (jCBP005.BizSeq == 1)
                        {
                            if (jCBP005.ReqList[i].ReturnTypeCd == "RT01")
                            {
                                query = "UPDATE " + sDB.SAPDB(jCBP005.BizSeq.ToString()) + "..ORRR SET U_WMSNY = 'C' WHERE DocEntry = '" + jCBP005.ReqList[i].ErpReqNo + "'";
                                //쿼리 실행
                                command = new SqlCommand(query, connection);
                                reader = command.ExecuteReader();
                                reader.Read();

                                oORRR = (Documents)MACRO_company.GetBusinessObject(BoObjectTypes.oReturnRequest);

                                //헤더
                                oORRR.GetByKey(int.Parse(jCBP005.ReqList[i].ErpReqNo));
                                oORRR.Cancel();

                                //오브젝트 초기화
                                if (oORRR != null)
                                {
                                    Marshal.ReleaseComObject(oORRR);
                                    oORRR = null;
                                }

                                reader.Close();
                            }
                            else
                            {
                                query = "UPDATE " + sDB.SAPDB(jCBP005.BizSeq.ToString()) + "..OWTQ SET U_WMSNY = 'C' WHERE DocEntry = '" + jCBP005.ReqList[i].ErpReqNo + "'";
                                //쿼리 실행
                                command = new SqlCommand(query, connection);
                                reader = command.ExecuteReader();
                                reader.Read();

                                oOWTQ = (StockTransfer)MACRO_company.GetBusinessObject(BoObjectTypes.oInventoryTransferRequest);
                                oOWTQ.GetByKey(int.Parse(jCBP005.ReqList[i].ErpReqNo));
                                oOWTQ.Close();

                                if (oOWTQ != null)
                                {
                                    Marshal.ReleaseComObject(oOWTQ);
                                    oOWTQ = null;
                                }

                                reader.Close();
                            }
                        }

                        //DI 문서 오류 처리
                        if (DIresult != 0)
                        {
                            if (jCBP005.BizSeq == 1)
                            {
                                ResultList.Add(new ResultListItem
                                {
                                    IfKey = jCBP005.ReqList[i].IfKey,
                                    ProcBundleNo = jCBP005.ReqList[i].ProcBundleNo,
                                    Result = "E",
                                    Message = $"DI Error: ${MACRO_company.GetLastErrorCode()} - ${MACRO_company.GetLastErrorDescription()}"
                                });
                                //throw new Exception($"DI Error: ${MACRO_company.GetLastErrorCode()} - ${MACRO_company.GetLastErrorDescription()}");
                            }
                            else
                            {
                                ResultList.Add(new ResultListItem
                                {
                                    IfKey = jCBP005.ReqList[i].IfKey,
                                    ProcBundleNo = jCBP005.ReqList[i].ProcBundleNo,
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
                                IfKey = jCBP005.ReqList[i].IfKey,
                                ProcBundleNo = jCBP005.ReqList[i].ProcBundleNo,
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

                if (oORRR != null)
                {
                    Marshal.ReleaseComObject(oORRR);
                    oORRR = null;
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