using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Data.SqlClient;
using MACRO_WMS.Models;
using System.Reflection.PortableExecutable;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using SAPbobsCOM;
using System.Runtime.InteropServices;
using MACRO_WMS.SAP;
using System.Drawing;

/* [예외출고예정취소]
 * 샘플
{
  "apikey": "emdc",
  "bizSeq": "1",
  "reqList": [
    {
      "ifKey": "1",
      "erpReqNo": "8841"
    },
    {
      "ifKey": "1",
      "erpReqNo": "8842"
    }
  ]
}
*/

namespace MACRO_WMS.Controllers
{
    [ApiController]
    [Route("[controller]")]

    public class CSM002Controller : ControllerBase
    {
        public class ApplicationDbContext : DbContext
        {
            public ApplicationDbContext(DbContextOptions<ApplicationDbContext> options) : base(options) { }
        }

        private readonly IConfiguration _configuration;
        private readonly ILogger<CSM002Controller> _logger;

        //SAP 관련 기본 변수
        private readonly DIAPI _sapDIAPI;
        private int DIresult;

        public CSM002Controller(ILogger<CSM002Controller> logger, IConfiguration configuration, DIAPI sapDIAPI)
        {
            _logger = logger;
            _configuration = configuration;
            _sapDIAPI = sapDIAPI;
        }

        /// <summary>
        /// 예외출고예정취소
        /// </summary>
        [HttpPost(Name = "CSM002")]
        public IActionResult GetItem([FromBody] CSM002 jCSM002)
        {
            _logger.LogWarning(jCSM002.ToString());

            // 객체를 JSON 문자열로 변환
            string jsonString = JsonSerializer.Serialize(jCSM002);

            _logger.LogWarning(jsonString);

            List<cResult> cResult = new List<cResult>();

            string connectionString = _configuration.GetConnectionString("DefaultConnection");
            string query = "";
            Company MACRO_company = _sapDIAPI.Get_MACRO_Company();
            Company SJ_company = _sapDIAPI.Get_SJ_Company();
            Documents oOPRR = null;
            Documents cancelDoc = null;
            SqlCommand command;
            SqlDataReader reader;
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
                if (jCSM002.APIKEY != "emdc")
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
                foreach (var jCSM002H in jCSM002.ReqList)
                {
                    try
                    {
                        ReIfKey = jCSM002H.IfKey;
                        ReProcBundleNo = jCSM002H.ProcBundleNo;

                        if (jCSM002.BizSeq == 1)
                        {
                            query = "UPDATE " + sDB.SAPDB(jCSM002.BizSeq.ToString()) + "..OPRR SET U_WMSNY = 'C' WHERE DocEntry = '" + jCSM002.ReqList[i].ErpReqNo + "'";
                            oOPRR = (Documents)MACRO_company.GetBusinessObject(BoObjectTypes.oGoodsReturnRequest);
                        }
                        else if (jCSM002.BizSeq == 2)
                        {
                            query = "UPDATE " + sDB.SAPDB(jCSM002.BizSeq.ToString()) + "..OPRR SET U_WMSNY = 'C' WHERE DocEntry = '" + jCSM002.ReqList[i].ErpReqNo + "'";
                            oOPRR = (Documents)SJ_company.GetBusinessObject(BoObjectTypes.oGoodsReturnRequest);
                        }

                        command = new SqlCommand(query, connection);
                        _logger.LogInformation(query);

                        //쿼리 실행
                        reader = command.ExecuteReader();
                        reader.Read();

                        //헤더
                        oOPRR.GetByKey(int.Parse(jCSM002.ReqList[i].ErpReqNo));
                        DIresult = oOPRR.Cancel();

                        //오브젝트 초기화
                        if (oOPRR != null)
                        {
                            Marshal.ReleaseComObject(oOPRR);
                            oOPRR = null;
                        }

                        reader.Close();

                        //DI 문서 오류 처리
                        if (DIresult != 0)
                        {
                            if (jCSM002.BizSeq == 1)
                            {
                                ResultList.Add(new ResultListItem
                                {
                                    IfKey = jCSM002.ReqList[i].IfKey,
                                    ProcBundleNo = jCSM002.ReqList[i].ProcBundleNo,
                                    Result = "E",
                                    Message = $"DI Error: ${MACRO_company.GetLastErrorCode()} - ${MACRO_company.GetLastErrorDescription()}"
                                });
                                //throw new Exception($"DI Error: ${MACRO_company.GetLastErrorCode()} - ${MACRO_company.GetLastErrorDescription()}");
                            }
                            else
                            {
                                ResultList.Add(new ResultListItem
                                {
                                    IfKey = jCSM002.ReqList[i].IfKey,
                                    ProcBundleNo = jCSM002.ReqList[i].ProcBundleNo,
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
                                IfKey = jCSM002.ReqList[i].IfKey,
                                ProcBundleNo = jCSM002.ReqList[i].ProcBundleNo,
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

                if (oOPRR != null)
                {
                    Marshal.ReleaseComObject(oOPRR);
                }

                return Ok(result);
            }
        }
    }
}