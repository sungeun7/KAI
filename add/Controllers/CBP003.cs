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
using System.Reflection.PortableExecutable;
using System.Security.Authentication.ExtendedProtection;
using System.Data;

/* [입고처리취소]
 * 샘플
{
  "apikey": "emdc",
  "bizSeq": "1",
  "reqList": [
    {
      "ifKey": "8841",
      "inwhTypeCd": "IW01",
      "inwhTypeDtlCd": "1",
      "centerSeq": "1",
      "wmsReqNo": "8841",
      "erpReqNo": "13078",
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

    public class CBP003Controller : ControllerBase
    {
        public class ApplicationDbContext : DbContext
        {
            public ApplicationDbContext(DbContextOptions<ApplicationDbContext> options) : base(options) { }
        }

        private readonly IConfiguration _configuration;
        private readonly ILogger<CBP003Controller> _logger;

        Dictionary<string, double> itemQuantities = new Dictionary<string, double>();

        bool isNewLine = false;

        // SAP 관련 기본 변수
        private readonly DIAPI _sapDIAPI;
        private int DIresult;
        SqlCommand command;
        SqlDataReader reader;

        //사용자변수
        private string oDocDate = "";

        public CBP003Controller(ILogger<CBP003Controller> logger, IConfiguration configuration, DIAPI sapDIAPI)
        {
            _logger = logger;
            _configuration = configuration;
            _sapDIAPI = sapDIAPI; 
        }

        /// <summary>
        /// 입고처리취소
        /// </summary>
        [HttpPost(Name = "CBP003")]
        public IActionResult GetItem([FromBody] CBP003 jCBP003)
        {
            _logger.LogWarning(jCBP003.ToString());

            // 객체를 JSON 문자열로 변환
            string jsonString = JsonSerializer.Serialize(jCBP003);

            _logger.LogWarning(jsonString);

            List<cResult> cResult = new List<cResult>();

            string connectionString = _configuration.GetConnectionString("DefaultConnection");
            string query = "";

            //SAP DI Connect
            Company MACRO_company = _sapDIAPI.Get_MACRO_Company();
            Company SJ_company = _sapDIAPI.Get_SJ_Company();
            Documents oOPDN = null;
            Documents oOIGE = null;
            Documents cancelDoc = null;
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
                if (jCBP003.APIKEY != "emdc")
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
                var distinctReqList = jCBP003.ReqList
                .GroupBy(x => x.ProcBundleNo)
                .Select(g => g.First())
                .ToList();

                //SQL 쿼리문 작성부분
                foreach (var jCBP003H in distinctReqList)
                {
                    try
                    {
                        ReIfKey = jCBP003H.IfKey;
                        ReProcBundleNo = jCBP003H.ProcBundleNo;

                        if (string.IsNullOrEmpty(jCBP003H.InwhTypeDtlCd))
                        {
                            jCBP003H.InwhTypeDtlCd = ""; // null 또는 빈 문자열인 경우 빈 문자열로 설정
                        }

                        if (jCBP003H.InwhTypeCd == "IW01")
                        {
                            if (jCBP003.BizSeq == 1)
                            {
                                oOPDN = (Documents)MACRO_company.GetBusinessObject(BoObjectTypes.oPurchaseDeliveryNotes);
                            }
                            else
                            {
                                oOPDN = (Documents)SJ_company.GetBusinessObject(BoObjectTypes.oPurchaseDeliveryNotes);
                            }

                            //구매오더 기준 입고문서 조회
                            query = " SELECT DocEntry FROM " + sDB.SAPDB(jCBP003.BizSeq.ToString()) + "..OPDN ";
                            query = query + " Where U_WMSDOCNUM = '" + jCBP003.ReqList[i].WmsReqNo + "'";
                            query = query + "   AND U_WMSNUM = '" + jCBP003.ReqList[i].ProcBundleNo + "'";
                            _logger.LogWarning(query);

                            //쿼리 실행
                            command = new SqlCommand(query, connection);
                            reader = command.ExecuteReader();
                            reader.Read();

                            //var jCBP003L = jCBP003.ReqList[i].ProdList;
                            //if (string.IsNullOrEmpty(jCBP003L.ToWh))
                            //{
                            //    jCBP003L.ToWh = ""; // null 또는 빈 문자열인 경우 빈 문자열로 설정
                            //}

                            //헤더
                            oOPDN.GetByKey(int.Parse(reader.GetInt32(0).ToString()));
                            cancelDoc = oOPDN.CreateCancellationDocument();
                            cancelDoc.DocDate = DateTime.ParseExact(jCBP003.ReqList[i].ProcYmd, "yyyyMMdd", null);

                            //문서 취소
                            DIresult = cancelDoc.Add();

                            //오브젝트 초기화
                            if (oOPDN != null)
                            {
                                Marshal.ReleaseComObject(cancelDoc);
                                Marshal.ReleaseComObject(oOPDN);
                                cancelDoc = null;
                                oOPDN = null;
                            }

                            reader.Close();

                            //DI 문서 오류 처리
                            if (DIresult != 0)
                            {
                                if (jCBP003.BizSeq == 1)
                                {
                                    ResultList.Add(new ResultListItem
                                    {
                                        IfKey = jCBP003.ReqList[i].IfKey,
                                        ProcBundleNo = jCBP003.ReqList[i].ProcBundleNo,
                                        Result = "E",
                                        Message = $"DI Error: ${MACRO_company.GetLastErrorCode()} - ${MACRO_company.GetLastErrorDescription()}"
                                    });
                                    //throw new Exception($"DI Error: ${MACRO_company.GetLastErrorCode()} - ${MACRO_company.GetLastErrorDescription()}");
                                }
                                else
                                {
                                    ResultList.Add(new ResultListItem
                                    {
                                        IfKey = jCBP003.ReqList[i].IfKey,
                                        ProcBundleNo = jCBP003.ReqList[i].ProcBundleNo,
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
                                    IfKey = jCBP003.ReqList[i].IfKey,
                                    ProcBundleNo = jCBP003.ReqList[i].ProcBundleNo,
                                    Result = "S",
                                    Message = "처리 완료"
                                });
                            }
                            i++;
                        }
                        else //기타출고문서 처리
                        {
                            if (jCBP003.BizSeq == 1)
                            {
                                oOIGE = (Documents)MACRO_company.GetBusinessObject(BoObjectTypes.oInventoryGenExit);
                            }
                            else
                            {
                                oOIGE = (Documents)SJ_company.GetBusinessObject(BoObjectTypes.oInventoryGenExit);
                            }

                            //기타출고 문서 생성
                            //헤더
                            oOIGE.DocDate = DateTime.ParseExact(jCBP003.ReqList[i].ProcYmd, "yyyyMMdd", null);
                            oOIGE.UserFields.Fields.Item("U_EtcMan").Value = jCBP003.ReqList[i].ProcUserId;

                            foreach (var jCBP003L in jCBP003.ReqList[i].ProdList)
                            {
                                if ((jCBP003L.ErpLineNo) != chk)
                                {
                                    if (j != 0)
                                    {
                                        oOIGE.Lines.Add();
                                        QTYSUM = 0;
                                    }
                                }

                                //라인
                                //기타입출고 계정 조회
                                query = " SELECT ZSM108L.U_AcctCode,OITM.AvgPrice ";
                                query = query + " From " + sDB.SAPDB(jCBP003.BizSeq.ToString()) + "..[@ZSM108H] ZSM108H";
                                query = query + " LEFT JOIN " + sDB.SAPDB(jCBP003.BizSeq.ToString()) + "..[@ZSM108L] ZSM108L ON ZSM108H.Code = ZSM108L.Code";
                                query = query + " LEFT JOIN " + sDB.SAPDB(jCBP003.BizSeq.ToString()) + "..[OITB] OITB ON OITB.ItmsGrpCod = ZSM108L.U_ItemGCod";
                                query = query + " LEFT JOIN " + sDB.SAPDB(jCBP003.BizSeq.ToString()) + "..[OITM] OITM ON OITM.ItemCode = '" + jCBP003L.IfProdId + "' AND OITM.ItmsGrpCod = ZSM108L.U_ItemGCod";
                                query = query + " Where ZSM108H.Code = '" + jCBP003.ReqList[i].InwhTypeDtlCd + "'";
                                _logger.LogWarning(query);

                                //쿼리 실행
                                command = new SqlCommand(query, connection);
                                reader = command.ExecuteReader();
                                reader.Read();

                                if (jCBP003.ReqList[i].InwhTypeDtlCd != "I-201") //소분입고가 아닐때만 이동평균처리
                                {
                                    var Price = reader.GetValue(1);
                                    oOIGE.Lines.UnitPrice = double.Parse(Price.ToString()); //이동평균처리
                                }

                                oOIGE.Lines.ItemCode = jCBP003L.IfProdId; //품목코드
                                QTYSUM = QTYSUM + jCBP003L.ExQty;
                                oOIGE.Lines.Quantity = QTYSUM; //수량
                                oOIGE.Lines.UoMEntry = 1;//EA
                                oOIGE.Lines.AccountCode = reader.GetString(0); //기타입출고계정
                                oOIGE.Lines.WarehouseCode = jCBP003L.ToWh;
                                oOIGE.Lines.UserFields.Fields.Item("U_LineType").Value = jCBP003.ReqList[i].InwhTypeDtlCd;
                                oOIGE.UserFields.Fields.Item("U_WMSDOCNUM").Value = jCBP003.ReqList[i].WmsReqNo;
                                oOIGE.UserFields.Fields.Item("U_WMSNUM").Value = jCBP003H.ProcBundleNo;

                                //배치
                                oOIGE.Lines.BatchNumbers.BatchNumber = jCBP003L.ErpBatchNo; //배치번호
                                oOIGE.Lines.BatchNumbers.Quantity = jCBP003L.ExQty; //수량
                                oOIGE.Lines.BatchNumbers.Add();

                                chk = (jCBP003L.ErpLineNo);

                                j++;
                                reader.Close();
                            }

                            //문서 추가
                            DIresult = oOIGE.Add();

                            j = 0;
                            QTYSUM = 0;
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
                                if (jCBP003.BizSeq == 1)
                                {
                                    ResultList.Add(new ResultListItem
                                    {
                                        IfKey = jCBP003.ReqList[i].IfKey,
                                        ProcBundleNo = jCBP003.ReqList[i].ProcBundleNo,
                                        Result = "E",
                                        Message = $"DI Error: ${MACRO_company.GetLastErrorCode()} - ${MACRO_company.GetLastErrorDescription()}"
                                    });
                                    //throw new Exception($"DI Error: ${MACRO_company.GetLastErrorCode()} - ${MACRO_company.GetLastErrorDescription()}");
                                }
                                else
                                {
                                    ResultList.Add(new ResultListItem
                                    {
                                        IfKey = jCBP003.ReqList[i].IfKey,
                                        ProcBundleNo = jCBP003.ReqList[i].ProcBundleNo,
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
                                    IfKey = jCBP003.ReqList[i].IfKey,
                                    ProcBundleNo = jCBP003.ReqList[i].ProcBundleNo,
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

                if (oOPDN != null)
                {
                    Marshal.ReleaseComObject(oOPDN);
                    oOPDN = null;
                }
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