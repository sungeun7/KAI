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

/* [SKU변경처리(기타출고)]
 * 샘플
{
  "apikey": "emdc",
  "bizSeq": "1",
  "reqList": [
    {
      "ifKey": "8841",
      "wmsReqNo": "IW01",
      "erpTypeCd": "1",
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

    public class CSM006Controller : ControllerBase
    {
        public class ApplicationDbContext : DbContext
        {
            public ApplicationDbContext(DbContextOptions<ApplicationDbContext> options) : base(options) { }

        }

        private readonly IConfiguration _configuration;
        private readonly ILogger<CSM006Controller> _logger;

        Dictionary<string, double> itemQuantities = new Dictionary<string, double>();

        bool isNewLine = false;

        // SAP 관련 기본 변수
        private readonly DIAPI _sapDIAPI;
        private int DIresult;

        //사용자변수
        private string oDocDate = "";

        public CSM006Controller(ILogger<CSM006Controller> logger, IConfiguration configuration, DIAPI sapDIAPI)
        {
            _logger = logger;
            _configuration = configuration;
            _sapDIAPI = sapDIAPI; 
        }

        /// <summary>
        /// SKU변경처리(기타출고)
        /// </summary>
        [HttpPost(Name = "CSM006")]
        public IActionResult GetItem([FromBody] CSM006 jCSM006)
        {
            _logger.LogWarning(jCSM006.ToString());

            // 객체를 JSON 문자열로 변환
            string jsonString = JsonSerializer.Serialize(jCSM006);

            _logger.LogWarning(jsonString);

            List<cResult> cResult = new List<cResult>();

            string connectionString = _configuration.GetConnectionString("DefaultConnection");

            //SAP DI Connect
            Company MACRO_company = _sapDIAPI.Get_MACRO_Company();
            Company SJ_company = _sapDIAPI.Get_SJ_Company();
            Documents oOIGE = null;
            SqlCommand command;
            SqlDataReader reader;
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
                if (jCSM006.APIKEY != "emdc")
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
                foreach (var jCSM006H in jCSM006.ReqList)
                {
                    try
                    {
                        ReIfKey = jCSM006H.IfKey;
                        ReProcBundleNo = jCSM006H.ProcBundleNo;

                        if (jCSM006.BizSeq == 1)
                        {
                            oOIGE = (Documents)MACRO_company.GetBusinessObject(BoObjectTypes.oInventoryGenExit);
                        }
                        else
                        {
                            oOIGE = (Documents)SJ_company.GetBusinessObject(BoObjectTypes.oInventoryGenExit);
                        }

                        //본문
                        foreach (var jCSM006L in jCSM006.ReqList[i].ProdList)
                        {
                            if (k != 0)
                            {
                                if ((jCSM006L.ErpBatchNo) != batchk)
                                {
                                    oOIGE.Lines.BatchNumbers.Add();
                                    j++;
                                    k = 0;
                                    BATSUM = 0;
                                }
                            }

                            if ((jCSM006L.ErpLineNo) != chk)
                            {
                                if (j != 0)
                                {
                                    oOIGE.Lines.Add();
                                    QTYSUM = 0;
                                }
                            }

                            //기타입출고 계정 조회
                            string query = " SELECT ZSM108L.U_AcctCode,OITM.AvgPrice ";
                            query = query + " From " + sDB.SAPDB(jCSM006.BizSeq.ToString()) + "..[@ZSM108H] ZSM108H";
                            query = query + " LEFT JOIN " + sDB.SAPDB(jCSM006.BizSeq.ToString()) + "..[@ZSM108L] ZSM108L ON ZSM108H.Code = ZSM108L.Code";
                            query = query + " LEFT JOIN " + sDB.SAPDB(jCSM006.BizSeq.ToString()) + "..[OITB] OITB ON OITB.ItmsGrpCod = ZSM108L.U_ItemGCod";
                            query = query + " LEFT JOIN " + sDB.SAPDB(jCSM006.BizSeq.ToString()) + "..[OITM] OITM ON OITM.ItemCode = '" + jCSM006L.IfProdId + "' AND OITM.ItmsGrpCod = ZSM108L.U_ItemGCod";
                            query = query + " Where ZSM108H.Code = '" + jCSM006.ReqList[i].ErpTypeCd + "'";
                            _logger.LogWarning(query);

                            //쿼리 실행
                            command = new SqlCommand(query, connection);
                            reader = command.ExecuteReader();
                            reader.Read();

                            //헤더
                            oOIGE.DocDate = DateTime.ParseExact(jCSM006.ReqList[i].ProcYmd, "yyyyMMdd", null);
                            oOIGE.TaxDate = DateTime.ParseExact(jCSM006.ReqList[i].ProcYmd, "yyyyMMdd", null);
                            oOIGE.UserFields.Fields.Item("U_WMSDOCNUM").Value = jCSM006.ReqList[i].WmsReqNo;

                            if (jCSM006.ReqList[i].ErpTypeCd == "O-400") //기타입출고유형
                            {
                                oOIGE.GroupNumber = 30; //그룹 확인 할 것
                            }
                            //oOIGE.Comments = "";

                            //oOIGE.Lines.LineNum = jCSM006L.ErpLineNo;
                            oOIGE.Lines.ItemCode = jCSM006L.IfProdId; //품목코드
                            QTYSUM = QTYSUM + jCSM006L.ExQty;
                            oOIGE.Lines.InventoryQuantity = QTYSUM; //수량
                            oOIGE.Lines.AccountCode = reader.GetString(0); //기타입출고계정
                            //oOIGE.Lines.UoMEntry = 1; //수량(EA : UOM)
                            oOIGE.Lines.WarehouseCode = jCSM006L.FrWh;
                            oOIGE.Lines.UserFields.Fields.Item("U_LineType").Value = jCSM006.ReqList[i].ErpTypeCd;

                            if (jCSM006.ReqList[i].ErpTypeCd != "O-400")
                            {
                                //oOIGE.Lines.UnitPrice = int.Parse(reader.GetString(1)); //이동평균처리
                                oOIGE.Lines.UnitPrice = (double)reader.GetDecimal(1); //241203 수정
                            }

                            chk = (jCSM006L.ErpLineNo);

                            //배치
                            oOIGE.Lines.BatchNumbers.ExpiryDate = DateTime.ParseExact(jCSM006L.ExpYmd, "yyyyMMdd", null);
                            BATSUM = BATSUM + jCSM006L.ExQty; //241212 추가
                            oOIGE.Lines.BatchNumbers.Quantity = BATSUM; //241212 추가
                            //oOIGE.Lines.BatchNumbers.Quantity = jCSM006L.ExQty;
                            oOIGE.Lines.BatchNumbers.BatchNumber = jCSM006L.ErpBatchNo; //jCSM006s.oITEMCODE + '@' + jCSM006s.oEXPTDATE;                            
                            oOIGE.Lines.BatchNumbers.Add();
                            
                            reader.Close();

                            if (string.IsNullOrEmpty(jCSM006L.FrLoc)) //241212 추가
                            {
                                jCSM006L.FrLoc = ""; // null 또는 빈 문자열인 경우 빈 문자열로 설정
                            }

                            if (jCSM006L.FrLoc != "") //241212 추가
                            {
                                //출고 창고 매핑 및 빈 위치 할당
                                query = "SELECT AbsEntry FROM " + sDB.SAPDB(jCSM006.BizSeq.ToString()) + "..OBIN WHERE BinCode = '" + jCSM006L.FrLoc + "'";
                                _logger.LogWarning(query);

                                //쿼리 실행
                                command = new SqlCommand(query, connection);
                                reader = command.ExecuteReader();
                                reader.Read();

                                oOIGE.Lines.BinAllocations.BinAbsEntry = reader.GetInt32(0); //빈코드
                                oOIGE.Lines.BinAllocations.SerialAndBatchNumbersBaseLine = k;
                                oOIGE.Lines.BinAllocations.BaseLineNumber = j;
                                oOIGE.Lines.BinAllocations.Quantity = jCSM006L.ExQty;
                                oOIGE.Lines.BinAllocations.Add();

                                reader.Close();
                            }

                            chk = (jCSM006L.ErpLineNo);
                            batchk = (jCSM006L.ErpBatchNo); //241212 추가

                            k++; //241212 추가
                        }

                        //마지막행 문서 추가
                        DIresult = oOIGE.Add();

                        k = 0; //241212 추가
                        QTYSUM = 0;
                        BATSUM = 0; //241212 추가
                        chk = 0;

                        //오브젝트 초기화
                        if (oOIGE != null)
                        {
                            Marshal.ReleaseComObject(oOIGE);
                            oOIGE = null;
                        }

                        //DI 문서 오류 처리
                        if (DIresult != 0)
                        {
                            if (jCSM006.BizSeq == 1)
                            {
                                ResultList.Add(new ResultListItem
                                {
                                    IfKey = jCSM006.ReqList[i].IfKey,
                                    ProcBundleNo = jCSM006.ReqList[i].ProcBundleNo,
                                    Result = "E",
                                    Message = $"DI Error: ${MACRO_company.GetLastErrorCode()} - ${MACRO_company.GetLastErrorDescription()}"
                                });
                                //throw new Exception($"DI Error: ${MACRO_company.GetLastErrorCode()} - ${MACRO_company.GetLastErrorDescription()}");
                            }
                            else
                            {
                                ResultList.Add(new ResultListItem
                                {
                                    IfKey = jCSM006.ReqList[i].IfKey,
                                    ProcBundleNo = jCSM006.ReqList[i].ProcBundleNo,
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
                                IfKey = jCSM006.ReqList[i].IfKey,
                                ProcBundleNo = jCSM006.ReqList[i].ProcBundleNo,
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