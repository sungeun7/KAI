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

/* [세트작업처리(기타입고)]
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

    public class CSM007Controller : ControllerBase
    {
        public class ApplicationDbContext : DbContext
        {
            public ApplicationDbContext(DbContextOptions<ApplicationDbContext> options) : base(options) { }
        }

        private readonly IConfiguration _configuration;
        private readonly ILogger<CSM007Controller> _logger;

        Dictionary<string, double> itemQuantities = new Dictionary<string, double>();

        bool isNewLine = false;

        // SAP 관련 기본 변수
        private readonly DIAPI _sapDIAPI;
        private int DIresult;

        //사용자변수
        private string oDocDate = "";

        public CSM007Controller(ILogger<CSM007Controller> logger, IConfiguration configuration, DIAPI sapDIAPI)
        {
            _logger = logger;
            _configuration = configuration;
            _sapDIAPI = sapDIAPI; 
        }

        /// <summary>
        /// 세트작업처리(기타입고)
        /// </summary>
        [HttpPost(Name = "CSM007")]
        public IActionResult GetItem([FromBody] CSM007 jCSM007)
        {
            _logger.LogWarning(jCSM007.ToString());

            // 객체를 JSON 문자열로 변환
            string jsonString = JsonSerializer.Serialize(jCSM007);

            _logger.LogWarning(jsonString);

            List<cResult> cResult = new List<cResult>();

            string connectionString = _configuration.GetConnectionString("DefaultConnection");

            //SAP DI Connect
            Company MACRO_company = _sapDIAPI.Get_MACRO_Company();
            Company SJ_company = _sapDIAPI.Get_SJ_Company();
            Documents oOIGN = null;
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
                if (jCSM007.APIKEY != "emdc")
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
                foreach (var jCSM007H in jCSM007.ReqList)
                {
                    try
                    {
                        ReIfKey = jCSM007H.IfKey;
                        ReProcBundleNo = jCSM007H.ProcBundleNo;

                        if (string.IsNullOrEmpty(jCSM007H.Note)) //241218 추가
                        {
                            jCSM007H.Note = ""; // null 또는 빈 문자열인 경우 빈 문자열로 설정
                        }

                        if (jCSM007.BizSeq == 1)
                        {
                            oOIGN = (Documents)MACRO_company.GetBusinessObject(BoObjectTypes.oInventoryGenEntry);
                        }
                        else
                        {
                            oOIGN = (Documents)SJ_company.GetBusinessObject(BoObjectTypes.oInventoryGenEntry);
                        }

                        //본문
                        foreach (var jCSM007L in jCSM007.ReqList[i].ProdList)
                        {
                            if ((jCSM007L.ErpLineNo) != chk)
                            {
                                if (j != 0)
                                {
                                    oOIGN.Lines.Add();
                                    QTYSUM = 0;
                                }
                            }

                            //기타입출고 계정 조회
                            string query = " SELECT ZSM108L.U_AcctCode, ITM1.Price, OITM.U_ITEMGB "; //250522 OITM.U_ITEMGB 추가
                            query = query + " From " + sDB.SAPDB(jCSM007.BizSeq.ToString()) + "..[@ZSM108H] ZSM108H";
                            query = query + " LEFT JOIN " + sDB.SAPDB(jCSM007.BizSeq.ToString()) + "..[@ZSM108L] ZSM108L ON ZSM108H.Code = ZSM108L.Code";
                            query = query + " LEFT JOIN " + sDB.SAPDB(jCSM007.BizSeq.ToString()) + "..[OITB] OITB ON OITB.ItmsGrpCod = ZSM108L.U_ItemGCod";
                            query = query + " LEFT JOIN " + sDB.SAPDB(jCSM007.BizSeq.ToString()) + "..[OITM] OITM ON OITM.ItemCode = '" + jCSM007L.IfProdId + "' AND OITM.ItmsGrpCod = ZSM108L.U_ItemGCod";
                            query = query + " LEFT JOIN " + sDB.SAPDB(jCSM007.BizSeq.ToString()) + "..[ITM1] ITM1 ON OITM.ItemCode = ITM1.ItemCode AND ITM1.PriceList = '30'"; //250416 추가
                            query = query + " Where ZSM108H.Code = '" + jCSM007.ReqList[i].ErpTypeCd + "'";
                            _logger.LogWarning(query);

                            //쿼리 실행
                            command = new SqlCommand(query, connection);
                            reader = command.ExecuteReader();
                            reader.Read();

                            //헤더
                            oOIGN.DocDate = DateTime.ParseExact(jCSM007.ReqList[i].ProcYmd, "yyyyMMdd", null);
                            oOIGN.TaxDate = DateTime.ParseExact(jCSM007.ReqList[i].ProcYmd, "yyyyMMdd", null);
                            oOIGN.UserFields.Fields.Item("U_WMSDOCNUM").Value = jCSM007.ReqList[i].WmsReqNo;
                            oOIGN.Comments = jCSM007.ReqList[i].Note; //241218 추가

                            //if (jCSM007.ReqList[i].ErpTypeCd == "I-202") //기타입출고유형
                            //{
                            //    oOIGN.GroupNumber = 30; //그룹 확인 할 것
                            //}
                            
                            //oOIGN.Lines.LineNum = jCSM007L.ErpLineNo;
                            oOIGN.Lines.ItemCode = jCSM007L.IfProdId; //품목코드
                            QTYSUM = QTYSUM + jCSM007L.ExQty;
                            oOIGN.Lines.InventoryQuantity = QTYSUM; //수량
                            oOIGN.Lines.AccountCode = reader.GetString(0); //기타입출고계정
                            //oOIGN.Lines.UoMEntry = 1; //수량(EA : UOM)
                            oOIGN.Lines.WarehouseCode = jCSM007L.ToWh;
                            oOIGN.Lines.UserFields.Fields.Item("U_LineType").Value = jCSM007.ReqList[i].ErpTypeCd;

                            string U_ITEMGB = reader.GetString(2); //250522 OITM.U_ITEMGB 추가

                            //if (jCSM007.ReqList[i].ErpTypeCd != "I-202") //250519 수정
                            if (U_ITEMGB != "3") //250522 수정
                            {
                                
                            }
                            else 
                            { 
                                oOIGN.Lines.UnitPrice = (double)reader.GetDecimal(1); //241203 수정
                            }

                            chk = (jCSM007L.ErpLineNo);

                            //배치
                            oOIGN.Lines.BatchNumbers.ExpiryDate = DateTime.ParseExact(jCSM007L.ExpYmd, "yyyyMMdd", null);
                            oOIGN.Lines.BatchNumbers.Quantity = jCSM007L.ExQty;
                            oOIGN.Lines.BatchNumbers.BatchNumber = jCSM007L.ErpBatchNo; //jCSM007s.oITEMCODE + '@' + jCSM007s.oEXPDATE;                            
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
                            if (jCSM007.BizSeq == 1)
                            {
                                ResultList.Add(new ResultListItem
                                {
                                    IfKey = jCSM007.ReqList[i].IfKey,
                                    ProcBundleNo = jCSM007.ReqList[i].ProcBundleNo,
                                    Result = "E",
                                    Message = $"DI Error: ${MACRO_company.GetLastErrorCode()} - ${MACRO_company.GetLastErrorDescription()}"
                                });
                                //throw new Exception($"DI Error: ${MACRO_company.GetLastErrorCode()} - ${MACRO_company.GetLastErrorDescription()}");
                            }
                            else
                            {
                                ResultList.Add(new ResultListItem
                                {
                                    IfKey = jCSM007.ReqList[i].IfKey,
                                    ProcBundleNo = jCSM007.ReqList[i].ProcBundleNo,
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
                                IfKey = jCSM007.ReqList[i].IfKey,
                                ProcBundleNo = jCSM007.ReqList[i].ProcBundleNo,
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