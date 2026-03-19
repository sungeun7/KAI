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
using System.Security.Authentication.ExtendedProtection;

/* [재고이동처리]
 * 샘플
{
  "apikey": "emdc",
  "bizSeq": "1",
  "reqList": [
    {
      "ifKey": "8841",
      "wmsReqNo": "8841",
      "procYmd": "20240827",
      "procHms": "120000",
      "procUserId": "MCR001",
      "prodList": [
        {
          "ifIdx": "0",
          "frWh": "1",
          "frLoc": "1",
          "toWh": "2",
          "toLoc": "2",          
          "ifProdId": "11411-054",
          "procQty": "120",
          "expYmd": "20240930",
          "lotNo": "11411-054-20240931",
          "erpBatchNo": "11411-054-20240827"
        },
        {
          "ifIdx": "1",
          "frWh": "1",
          "frLoc": "1",
          "toWh": "3",
          "toLoc": "3",          
          "ifProdId": "11411-055",
          "procQty": "120",
          "expYmd": "20240930",
          "lotNo": "11411-054-20240931",
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

    public class CSM001Controller : ControllerBase
    {
        public class ApplicationDbContext : DbContext
        {
            public ApplicationDbContext(DbContextOptions<ApplicationDbContext> options) : base(options) { }
        }
        
        private readonly IConfiguration _configuration;
        private readonly ILogger<CSM001Controller> _logger;

        Dictionary<string, double> itemQuantities = new Dictionary<string, double>();

        bool isNewLine = false;

        // SAP 관련 기본 변수
        private readonly DIAPI _sapDIAPI;
        private int DIresult;

        //사용자변수
        private string oDocDate = "";

        public CSM001Controller(ILogger<CSM001Controller> logger, IConfiguration configuration, DIAPI sapDIAPI)
        {
            _logger = logger;
            _configuration = configuration;
            _sapDIAPI = sapDIAPI;
        }

        /// <summary>
        /// 재고이동처리
        /// </summary>
        [HttpPost(Name = "CSM001")]
        public IActionResult GetItem([FromBody] CSM001 jCSM001)
        {
            _logger.LogCritical(jCSM001.ToString());

            // 객체를 JSON 문자열로 변환
            string jsonString = JsonSerializer.Serialize(jCSM001);

            _logger.LogWarning(jsonString);

            List<cResult> cResult = new List<cResult>();

            string connectionString = _configuration.GetConnectionString("DefaultConnection");

            //SAP DI Connect
            Company MACRO_company = _sapDIAPI.Get_MACRO_Company();
            Company SJ_company = _sapDIAPI.Get_SJ_Company();
            StockTransfer oOWTR = null;
            SqlCommand command;
            SqlDataReader reader;
            string query;
            SAP.SAP sDB = new SAP.SAP();

            int i = 0;
            int j = 0;
            int k = 0;
            int chk = 0;
            int QTYSUM = 0;
            int BATSUM = 0;
            string batchk = "";
            string ReIfKey = "";
            string ReProcBundleNo = "";
            
            List<ResultListItem> ResultList = new List<ResultListItem>();

            using (SqlConnection connection = new SqlConnection(connectionString))
            {   
                //DB 연결
                connection.Open();

                //API KEY 체크(최소한의 보안)
                if (jCSM001.APIKEY != "emdc")
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
                foreach (var jCSM001H in jCSM001.ReqList)
                {
                    try
                    {
                        ReIfKey = jCSM001H.IfKey;
                        ReProcBundleNo = jCSM001H.ProcBundleNo;

                        if (jCSM001.BizSeq == 1)
                        {
                            oOWTR = (StockTransfer)MACRO_company.GetBusinessObject(BoObjectTypes.oStockTransfer);
                        }
                        else
                        {
                            oOWTR = (StockTransfer)SJ_company.GetBusinessObject(BoObjectTypes.oStockTransfer);
                        }

                        //본문
                        foreach (var jCSM001L in jCSM001.ReqList[i].ProdList)
                        {
                            if (k != 0)
                            {
                                if ((jCSM001L.ErpBatchNo) != batchk)
                                {
                                    oOWTR.Lines.BatchNumbers.Add();
                                    BATSUM = 0;
                                }
                                else //241219 수정
                                {
                                    if ((jCSM001L.ErpLineNo) != chk)
                                    {
                                        oOWTR.Lines.BatchNumbers.Add();
                                        BATSUM = 0;
                                    }
                                }
                            }

                            if ((jCSM001L.ErpLineNo) != chk)
                            {
                                //if (j != 0) //241219 수정
                                //{
                                    oOWTR.Lines.Add();
                                    k = 0;
                                    QTYSUM = 0;
                                //}
                            }

                            //헤더
                            oOWTR.DocDate = DateTime.ParseExact(jCSM001.ReqList[i].ProcYmd, "yyyyMMdd", null);
                            oOWTR.TaxDate = DateTime.ParseExact(jCSM001.ReqList[i].ProcYmd, "yyyyMMdd", null);
                            oOWTR.FromWarehouse = jCSM001L.FrWh; //241206 추가
                            oOWTR.ToWarehouse = jCSM001L.ToWh; //241206 추가
                            oOWTR.UserFields.Fields.Item("U_WMSDOCNUM").Value = jCSM001.ReqList[i].WmsReqNo;
                            //oOWTR.Comments = "";

                            //oOWTR.Lines.LineNum = jCSM001L.IfIdx;
                            oOWTR.Lines.FromWarehouseCode = jCSM001L.FrWh; //창고(Fr)
                            oOWTR.Lines.WarehouseCode = jCSM001L.ToWh; //창고(To)
                            oOWTR.Lines.ItemCode = jCSM001L.IfProdId; //품목코드
                            QTYSUM = QTYSUM + jCSM001L.ProcQty;
                            oOWTR.Lines.InventoryQuantity = QTYSUM; //수량
                            oOWTR.Lines.UoMEntry = 1; //수량(EA : UOM)

                            //배치
                            BATSUM = BATSUM + jCSM001L.ProcQty;
                            oOWTR.Lines.BatchNumbers.Quantity = BATSUM;
                            oOWTR.Lines.BatchNumbers.BatchNumber = jCSM001L.ErpBatchNo; //jCSM001s.oITEMCODE + '@' + jCSM001s.oEXPDATE;

                            if (string.IsNullOrEmpty(jCSM001L.FrLoc))
                            {
                                jCSM001L.FrLoc = ""; // null 또는 빈 문자열인 경우 빈 문자열로 설정
                            }

                            if (jCSM001L.FrLoc != "")
                            {
                                //출고 창고 매핑 및 빈 위치 할당
                                query = "SELECT AbsEntry FROM " + sDB.SAPDB(jCSM001.BizSeq.ToString()) + "..OBIN WHERE BinCode = '" + jCSM001L.FrLoc + "'";
                                _logger.LogWarning(query);

                                //쿼리 실행
                                command = new SqlCommand(query, connection);
                                reader = command.ExecuteReader();
                                reader.Read();

                                oOWTR.Lines.BinAllocations.BinAbsEntry = reader.GetInt32(0); //빈코드
                                oOWTR.Lines.BinAllocations.BinActionType = BinActionTypeEnum.batFromWarehouse;
                                oOWTR.Lines.BinAllocations.SerialAndBatchNumbersBaseLine = k;
                                oOWTR.Lines.BinAllocations.BaseLineNumber = j;
                                oOWTR.Lines.BinAllocations.Quantity = jCSM001L.ProcQty;
                                oOWTR.Lines.BinAllocations.Add();

                                reader.Close();
                            }

                            if (string.IsNullOrEmpty(jCSM001L.ToLoc))
                            {
                                jCSM001L.ToLoc = ""; // null 또는 빈 문자열인 경우 빈 문자열로 설정
                            }

                            if (jCSM001L.ToLoc != "")
                            {
                                //입고 창고 매핑 및 빈 위치 할당
                                query = "SELECT AbsEntry FROM " + sDB.SAPDB(jCSM001.BizSeq.ToString()) + "..OBIN WHERE BinCode = '" + jCSM001L.ToLoc + "'";
                                _logger.LogWarning(query);

                                //쿼리 실행
                                command = new SqlCommand(query, connection);
                                reader = command.ExecuteReader();
                                reader.Read();

                                oOWTR.Lines.BinAllocations.BinAbsEntry = reader.GetInt32(0); //빈코드
                                oOWTR.Lines.BinAllocations.BinActionType = BinActionTypeEnum.batToWarehouse;
                                oOWTR.Lines.BinAllocations.SerialAndBatchNumbersBaseLine = k; //241219 수정
                                oOWTR.Lines.BinAllocations.BaseLineNumber = j;
                                oOWTR.Lines.BinAllocations.Quantity = jCSM001L.ProcQty;
                                oOWTR.Lines.BinAllocations.Add();
                                reader.Close();
                            }
                            
                            chk = (jCSM001L.ErpLineNo);
                            batchk = (jCSM001L.ErpBatchNo);
                            k++;
                            j++; //250529 추가
                        }

                        //마지막행 문서 추가
                        DIresult = oOWTR.Add();

                        j = 0; //241219 수정
                        k = 0;
                        QTYSUM = 0;
                        BATSUM = 0;
                        chk = 0;
                        batchk = ""; //241219 수정

                        //오브젝트 초기화
                        if (oOWTR != null)
                        {
                            Marshal.ReleaseComObject(oOWTR);
                            oOWTR = null;
                        }

                        //DI 문서 오류 처리
                        if (DIresult != 0)
                        {
                            if (jCSM001.BizSeq == 1)
                            {
                                ResultList.Add(new ResultListItem
                                {
                                    IfKey = jCSM001.ReqList[i].IfKey,
                                    ProcBundleNo = jCSM001.ReqList[i].ProcBundleNo,
                                    Result = "E",
                                    Message = $"DI Error: ${MACRO_company.GetLastErrorCode()} - ${MACRO_company.GetLastErrorDescription()}"
                                });
                                //throw new Exception($"DI Error: ${MACRO_company.GetLastErrorCode()} - ${MACRO_company.GetLastErrorDescription()}");
                            }
                            else
                            {
                                ResultList.Add(new ResultListItem
                                {
                                    IfKey = jCSM001.ReqList[i].IfKey,
                                    ProcBundleNo = jCSM001.ReqList[i].ProcBundleNo,
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
                                IfKey = jCSM001.ReqList[i].IfKey,
                                ProcBundleNo = jCSM001.ReqList[i].ProcBundleNo,
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

                if (oOWTR != null)
                {
                    Marshal.ReleaseComObject(oOWTR);
                    oOWTR = null;
                }

                return Ok(result);
            }
        }
    }
}