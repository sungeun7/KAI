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
using System.Text.RegularExpressions;

/* [SKU변경처리(기타입고)]
 * 샘플
{
  "apikey": "emdc",
  "bizSeq": "1",
  "reqList": [
    {
      "ifKey": "8841",
      "wmsReqNo": "IW01",
      "erpTypeCd": "EX95",
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

    public class CSM005Controller : ControllerBase
    {
        public class ApplicationDbContext : DbContext
        {
            public ApplicationDbContext(DbContextOptions<ApplicationDbContext> options) : base(options) { }
        }

        private readonly IConfiguration _configuration;
        private readonly ILogger<CSM005Controller> _logger;

        Dictionary<string, double> itemQuantities = new Dictionary<string, double>();

        bool isNewLine = false;

        // SAP 관련 기본 변수
        private readonly DIAPI _sapDIAPI;
        private int DIresult;

        //사용자변수
        private string oDocDate = "";

        public CSM005Controller(ILogger<CSM005Controller> logger, IConfiguration configuration, DIAPI sapDIAPI)
        {
            _logger = logger;
            _configuration = configuration;
            _sapDIAPI = sapDIAPI; 
        }

        /// <summary>
        /// SKU변경처리(기타입고)
        /// </summary>
        [HttpPost(Name = "CSM005")]
        public IActionResult GetItem([FromBody] CSM005 jCSM005)
        {
            _logger.LogCritical(jCSM005.ToString());

            // 객체를 JSON 문자열로 변환
            string jsonString = JsonSerializer.Serialize(jCSM005);

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
                if (jCSM005.APIKEY != "emdc")
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
                foreach (var jCSM005H in jCSM005.ReqList)
                {
                    try
                    {
                        ReIfKey = jCSM005H.IfKey;
                        ReProcBundleNo = jCSM005H.ProcBundleNo;

                        if (jCSM005.BizSeq == 1)
                        {
                            oOIGN = (Documents)MACRO_company.GetBusinessObject(BoObjectTypes.oInventoryGenEntry);
                        }
                        else
                        {
                            oOIGN = (Documents)SJ_company.GetBusinessObject(BoObjectTypes.oInventoryGenEntry);
                        }

                        //본문
                        foreach (var jCSM005L in jCSM005.ReqList[i].ProdList)
                        {
                            if (k != 0) //241212 추가
                            {
                                if ((jCSM005L.ErpBatchNo) != batchk)
                                {
                                    oOIGN.Lines.BatchNumbers.Add();
                                    j++;
                                    k = 0;
                                    BATSUM = 0;
                                }
                            }

                            if ((jCSM005L.ErpLineNo) != chk)
                            {
                                if (j != 0)
                                {
                                    oOIGN.Lines.Add();
                                    QTYSUM = 0;
                                }
                            }

                            //기타입출고 계정 조회
                            string query = " SELECT ZSM108L.U_AcctCode,OITM.AvgPrice ";
                            query = query + " From " + sDB.SAPDB(jCSM005.BizSeq.ToString()) + "..[@ZSM108H] ZSM108H";
                            query = query + " LEFT JOIN " + sDB.SAPDB(jCSM005.BizSeq.ToString()) + "..[@ZSM108L] ZSM108L ON ZSM108H.Code = ZSM108L.Code";
                            query = query + " LEFT JOIN " + sDB.SAPDB(jCSM005.BizSeq.ToString()) + "..[OITB] OITB ON OITB.ItmsGrpCod = ZSM108L.U_ItemGCod";
                            query = query + " LEFT JOIN " + sDB.SAPDB(jCSM005.BizSeq.ToString()) + "..[OITM] OITM ON OITM.ItemCode = '" + jCSM005L.IfProdId + "' AND OITM.ItmsGrpCod = ZSM108L.U_ItemGCod";
                            query = query + " Where ZSM108H.Code = '" + jCSM005.ReqList[i].ErpTypeCd + "'";
                            _logger.LogWarning(query);

                            //쿼리 실행
                            command = new SqlCommand(query, connection);
                            reader = command.ExecuteReader();
                            reader.Read();

                            //헤더
                            oOIGN.DocDate = DateTime.ParseExact(jCSM005.ReqList[i].ProcYmd, "yyyyMMdd", null);
                            oOIGN.TaxDate = DateTime.ParseExact(jCSM005.ReqList[i].ProcYmd, "yyyyMMdd", null);
                            oOIGN.UserFields.Fields.Item("U_WMSDOCNUM").Value = jCSM005.ReqList[i].WmsReqNo;

                            if (jCSM005.ReqList[i].ErpTypeCd == "I-300") //기타입출고유형
                            {
                                oOIGN.GroupNumber = 30; //그룹 확인 할 것
                            }
                            //oOIGN.Comments = "";

                            //oOIGN.Lines.LineNum = jCSM005L.IfIdx;
                            oOIGN.Lines.ItemCode = jCSM005L.IfProdId; //품목코드
                            QTYSUM = QTYSUM + jCSM005L.ExQty;
                            oOIGN.Lines.InventoryQuantity = QTYSUM; //수량
                            oOIGN.Lines.AccountCode = reader.GetString(0); //기타입출고계정
                            //oOIGN.Lines.UoMEntry = 1; //수량(EA : UOM)
                            oOIGN.Lines.WarehouseCode = jCSM005L.ToWh;
                            oOIGN.Lines.UserFields.Fields.Item("U_LineType").Value = jCSM005.ReqList[i].ErpTypeCd;

                            if (jCSM005.ReqList[i].ErpTypeCd != "I-300")
                            {
                                //oOIGN.Lines.UnitPrice = int.Parse(reader.GetString(1)); //이동평균처리
                                oOIGN.Lines.UnitPrice = (double)reader.GetDecimal(1); //241203 수정
                            }

                            chk = (jCSM005L.ErpLineNo);

                            //배치
                            oOIGN.Lines.BatchNumbers.ExpiryDate = DateTime.ParseExact(jCSM005L.ExpYmd, "yyyyMMdd", null);
                            BATSUM = BATSUM + jCSM005L.ExQty; //241212 추가
                            oOIGN.Lines.BatchNumbers.Quantity = BATSUM; //241212 추가
                            //oOIGN.Lines.BatchNumbers.Quantity = jCSM005L.ExQty;
                            oOIGN.Lines.BatchNumbers.BatchNumber = jCSM005L.ErpBatchNo; //jCSM005L.oITEMCODE + '@' + jCSM005L.oEXPDATE;
                            oOIGN.Lines.BatchNumbers.Add();

                            reader.Close();

                            if (string.IsNullOrEmpty(jCSM005L.ToLoc)) //241212 추가
                            {
                                jCSM005L.ToLoc = ""; // null 또는 빈 문자열인 경우 빈 문자열로 설정
                            }

                            if (jCSM005L.ToLoc != "") //241212 추가
                            {
                                //입고 창고 매핑 및 빈 위치 할당
                                query = "SELECT AbsEntry FROM " + sDB.SAPDB(jCSM005.BizSeq.ToString()) + "..OBIN WHERE BinCode = '" + jCSM005L.ToLoc + "'";
                                _logger.LogWarning(query);

                                //쿼리 실행
                                command = new SqlCommand(query, connection);
                                reader = command.ExecuteReader();
                                reader.Read();

                                oOIGN.Lines.BinAllocations.BinAbsEntry = reader.GetInt32(0); //빈코드
                                oOIGN.Lines.BinAllocations.SerialAndBatchNumbersBaseLine = 0;
                                oOIGN.Lines.BinAllocations.BaseLineNumber = j;
                                oOIGN.Lines.BinAllocations.Quantity = jCSM005L.ExQty;
                                oOIGN.Lines.BinAllocations.Add();
                                reader.Close();
                            }
                            
                            chk = (jCSM005L.ErpLineNo);
                            batchk = (jCSM005L.ErpBatchNo); //241212 추가

                            k++; //241212 추가
                        }

                        //마지막행 문서 추가
                        DIresult = oOIGN.Add();

                        k = 0; //241212 추가
                        QTYSUM = 0;
                        BATSUM = 0; //241212 추가
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
                            if (jCSM005.BizSeq == 1)
                            {
                                ResultList.Add(new ResultListItem
                                {
                                    IfKey = jCSM005.ReqList[i].IfKey,
                                    ProcBundleNo = jCSM005.ReqList[i].ProcBundleNo,
                                    Result = "E",
                                    Message = $"DI Error: ${MACRO_company.GetLastErrorCode()} - ${MACRO_company.GetLastErrorDescription()}"
                                });
                                //throw new Exception($"DI Error: ${MACRO_company.GetLastErrorCode()} - ${MACRO_company.GetLastErrorDescription()}");
                            }
                            else
                            {
                                ResultList.Add(new ResultListItem
                                {
                                    IfKey = jCSM005.ReqList[i].IfKey,
                                    ProcBundleNo = jCSM005.ReqList[i].ProcBundleNo,
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
                                IfKey = jCSM005.ReqList[i].IfKey,
                                ProcBundleNo = jCSM005.ReqList[i].ProcBundleNo,
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