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

/* [출하예정취소]
 * 샘플
{
  "apikey": "emdc",
  "bizSeq": "1",
  "reqList": [
    {
      "ifKey": "1",
      "outbizTypeCd": "1",
      "centerSeq": "2",
      "erpReqTypCd": "2",
      "erpReqNo": "8841",
      "erpPickingNo": "2"
    },
    {
      "ifKey": "1",
      "outbizTypeCd": "1",
      "centerSeq": "3",
      "erpReqTypCd": "3",
      "erpReqNo": "8842",
      "erpPickingNo": "3"
    }
  ]
}
*/

namespace MACRO_WMS.Controllers
{
    [ApiController]
    [Route("[controller]")]

    public class CVA001Controller : ControllerBase
    {
        public class ApplicationDbContext : DbContext
        {
            public ApplicationDbContext(DbContextOptions<ApplicationDbContext> options) : base(options) { }
        }

        private readonly IConfiguration _configuration;
        private readonly ILogger<CVA001Controller> _logger;

        // SAP 관련 기본 변수
        private readonly DIAPI _sapDIAPI;
        private int DIresult;

        public CVA001Controller(ILogger<CVA001Controller> logger, IConfiguration configuration, DIAPI sapDIAPI)
        {
            _logger = logger;
            _configuration = configuration;
            _sapDIAPI = sapDIAPI;
        }

        /// <summary>
        /// 출하예정취소
        /// </summary>
        [HttpPost(Name = "CVA001")]
        public IActionResult GetItem([FromBody] CVA001 jCVA001)
        {
            _logger.LogWarning(jCVA001.ToString());

            // 객체를 JSON 문자열로 변환
            string jsonString = JsonSerializer.Serialize(jCVA001);

            _logger.LogWarning(jsonString);

            List<cResult> cResult = new List<cResult>();

            string connectionString = _configuration.GetConnectionString("DefaultConnection");
            string query = "";
            Company MACRO_company = _sapDIAPI.Get_MACRO_Company();
            Company SJ_company = _sapDIAPI.Get_SJ_Company();
            Documents oORDR = null;
            StockTransfer oOWTQ = null;
            PickLists oOPKL = null;
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
                if (jCVA001.APIKEY != "emdc")
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
                foreach (var jCVA001H in jCVA001.ReqList)
                {
                    try
                    {
                        ReIfKey = jCVA001H.IfKey;
                        ReProcBundleNo = jCVA001H.ProcBundleNo;

                        if (string.IsNullOrEmpty(jCVA001H.ErpPickingNo))
                        {
                            jCVA001H.ErpPickingNo = ""; // null 또는 빈 문자열인 경우 빈 문자열로 설정
                        }

                        if (jCVA001H.ErpReqTypCd == "ORDR")
                        {
                            if (jCVA001.BizSeq == 1)
                            {
                                //query = "UPDATE " + sDB.SAPDB(jCVA001.BizSeq.ToString()) + "..PKL1 SET U_WMSNY = 'C' WHERE AbsEntry = '" + jCVA001.ReqList[i].ErpPickingNo + "' AND OrderEntry ='" + jCVA001.ReqList[i].ErpReqNo + "'";
                                query = "UPDATE " + sDB.SAPDB(jCVA001.BizSeq.ToString()) + "..ORDR SET U_WMSNY = 'N' WHERE DocEntry = '" + jCVA001.ReqList[i].ErpReqNo + "'";
                                //oORDR = (Documents)MACRO_company.GetBusinessObject(BoObjectTypes.oOrders);
                                oOPKL = (PickLists)MACRO_company.GetBusinessObject(BoObjectTypes.oPickLists);
                            }
                            else if (jCVA001.BizSeq == 2)
                            {
                                //query = "UPDATE " + sDB.SAPDB(jCVA001.BizSeq.ToString()) + "..PKL1 SET U_WMSNY = 'C' WHERE AbsEntry = '" + jCVA001.ReqList[i].ErpPickingNo + "' AND OrderEntry ='" + jCVA001.ReqList[i].ErpReqNo + "'";
                                query = "UPDATE " + sDB.SAPDB(jCVA001.BizSeq.ToString()) + "..ORDR SET U_WMSNY = 'N' WHERE DocEntry = '" + jCVA001.ReqList[i].ErpReqNo + "'";
                                //oORDR = (Documents)SJ_company.GetBusinessObject(BoObjectTypes.oOrders);
                                oOPKL = (PickLists)SJ_company.GetBusinessObject(BoObjectTypes.oPickLists);
                            }

                            //쿼리 실행
                            command = new SqlCommand(query, connection);
                            reader = command.ExecuteReader();
                            reader.Read();

                            ////헤더
                            //oORDR.GetByKey(int.Parse(jCVA001.ReqList[i].ErpReqNo));
                            //oORDR.Cancel();

                            //피킹 취소
                            oOPKL.GetByKey(int.Parse(jCVA001.ReqList[i].ErpPickingNo));

                            for (int j = 0; j < oOPKL.Lines.Count; j++)
                            {
                                oOPKL.Lines.SetCurrentLine(j);
                                if (oOPKL.Lines.OrderEntry == int.Parse(jCVA001.ReqList[i].ErpReqNo))
                                {
                                    oOPKL.Lines.PickedQuantity = 0;
                                    oOPKL.Lines.ReleasedQuantity = 0;
                                }
                            }
                            DIresult = oOPKL.UpdateReleasedAllocation();

                            oOPKL = null;

                            if (jCVA001.BizSeq == 1)
                            {
                                oOPKL = (PickLists)MACRO_company.GetBusinessObject(BoObjectTypes.oPickLists);
                            }
                            else if (jCVA001.BizSeq == 2)
                            {
                                oOPKL = (PickLists)SJ_company.GetBusinessObject(BoObjectTypes.oPickLists);
                            }

                            //릴리즈 취소
                            oOPKL.GetByKey(int.Parse(jCVA001.ReqList[i].ErpPickingNo));

                            for (int j = 0; j < oOPKL.Lines.Count; j++)
                            {
                                oOPKL.Lines.SetCurrentLine(j);
                                if (oOPKL.Lines.OrderEntry == int.Parse(jCVA001.ReqList[i].ErpReqNo))
                                {
                                    oOPKL.Lines.PickedQuantity = 0;
                                    oOPKL.Lines.ReleasedQuantity = 0;
                                }
                            }
                            DIresult = oOPKL.Update();

                            //오브젝트 초기화
                            Marshal.ReleaseComObject(oOPKL);
                            oOPKL    = null;
                            //Marshal.ReleaseComObject(oORDR);
                            //oORDR = null;
                            reader.Close();

                            //DI 문서 오류 처리
                            if (DIresult != 0)
                            {
                                if (jCVA001.BizSeq == 1)
                                {
                                    ResultList.Add(new ResultListItem
                                    {
                                        IfKey = jCVA001.ReqList[i].IfKey,
                                        ProcBundleNo = jCVA001.ReqList[i].ProcBundleNo,
                                        Result = "E",
                                        Message = $"DI Error: ${MACRO_company.GetLastErrorCode()} - ${MACRO_company.GetLastErrorDescription()}"
                                    });
                                    //throw new Exception($"DI Error: ${MACRO_company.GetLastErrorCode()} - ${MACRO_company.GetLastErrorDescription()}");
                                }
                                else
                                {
                                    ResultList.Add(new ResultListItem
                                    {
                                        IfKey = jCVA001.ReqList[i].IfKey,
                                        ProcBundleNo = jCVA001.ReqList[i].ProcBundleNo,
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
                                    IfKey = jCVA001.ReqList[i].IfKey,
                                    ProcBundleNo = jCVA001.ReqList[i].ProcBundleNo,
                                    Result = "S",
                                    Message = "처리 완료"
                                });
                            }
                            i++;
                        }
                        else
                        {
                            if (jCVA001.BizSeq == 1)
                            {
                                query = "UPDATE " + sDB.SAPDB(jCVA001.BizSeq.ToString()) + "..OWTQ SET U_WMSNY = 'C' WHERE DocEntry ='" + jCVA001.ReqList[i].ErpReqNo + "'"; //241210 추가
                                oOWTQ = (StockTransfer)MACRO_company.GetBusinessObject(BoObjectTypes.oInventoryTransferRequest);
                            }
                            else
                            {
                                query = "UPDATE " + sDB.SAPDB(jCVA001.BizSeq.ToString()) + "..OWTQ SET U_WMSNY = 'C' WHERE DocEntry ='" + jCVA001.ReqList[i].ErpReqNo + "'"; //241210 추가
                                oOWTQ = (StockTransfer)SJ_company.GetBusinessObject(BoObjectTypes.oInventoryTransferRequest);
                            }

                            //쿼리 실행
                            command = new SqlCommand(query, connection);
                            reader = command.ExecuteReader();
                            reader.Read();

                            //헤더
                            oOWTQ.GetByKey(int.Parse(jCVA001.ReqList[i].ErpReqNo));
                            DIresult = oOWTQ.Close(); //241212 수정

                            //오브젝트 초기화
                            Marshal.ReleaseComObject(oOWTQ);
                            oOWTQ = null;

                            reader.Close();

                            //DI 문서 오류 처리
                            if (DIresult != 0)
                            {
                                if (jCVA001.BizSeq == 1)
                                {
                                    ResultList.Add(new ResultListItem
                                    {
                                        IfKey = jCVA001.ReqList[i].IfKey,
                                        ProcBundleNo = jCVA001.ReqList[i].ProcBundleNo,
                                        Result = "E",
                                        Message = $"DI Error: ${MACRO_company.GetLastErrorCode()} - ${MACRO_company.GetLastErrorDescription()}"
                                    });
                                    //throw new Exception($"DI Error: ${MACRO_company.GetLastErrorCode()} - ${MACRO_company.GetLastErrorDescription()}");
                                }
                                else
                                {
                                    ResultList.Add(new ResultListItem
                                    {
                                        IfKey = jCVA001.ReqList[i].IfKey,
                                        ProcBundleNo = jCVA001.ReqList[i].ProcBundleNo,
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
                                    IfKey = jCVA001.ReqList[i].IfKey,
                                    ProcBundleNo = jCVA001.ReqList[i].ProcBundleNo,
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