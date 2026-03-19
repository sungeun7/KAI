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
using Microsoft.EntityFrameworkCore.Query.SqlExpressions;
using System.Collections.Generic;
using Microsoft.AspNetCore.Http;

/* [반품마감]
 * 샘플
{
  "apikey": "emdc",
  "bizSeq": "1",
  "reqList": [
    {
      "ifKey": "8841",
      "returnTypeCd": "IW01",
      "centerSeq": "1",
      "wmsReqNo": "8841",
      "erpReqNo": "8841",
      "prodList": [
        {
          "ifIdx": "0",
          "ifProdId": "11411-054",
          "exQty": "120",
          "lotNo": "11411-054-20240931",
          "expYmd": "20240930",
          "erpBatchNo": "11411-054-20240827",
          "procYmd": "20240827",
          "procHms": "120000",
          "procUserId": "MCR001"
        },
        {
          "ifIdx": "1",
          "ifProdId": "11411-055",
          "exQty": "120",
          "lotNo": "11411-055-20240931",
          "expYmd": "20240930",
          "erpBatchNo": "11411-054-20240827",
          "procYmd": "20240827",
          "procHms": "120000",
          "procUserId": "MCR001"
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

    public class CBP006Controller : ControllerBase
    {
        public class ApplicationDbContext : DbContext
        {
            public ApplicationDbContext(DbContextOptions<ApplicationDbContext> options) : base(options) { }
        }

        private readonly IConfiguration _configuration;
        private readonly ILogger<CBP006Controller> _logger;

        Dictionary<string, double> itemQuantities = new Dictionary<string, double>();

        bool isNewLine = false;

        // SAP 관련 기본 변수
        private readonly DIAPI _sapDIAPI;
        private int DIresult;

        //사용자변수
        private string oDocDate = "";

        public CBP006Controller(ILogger<CBP006Controller> logger, IConfiguration configuration, DIAPI sapDIAPI)
        {
            _logger = logger;
            _configuration = configuration;
            _sapDIAPI = sapDIAPI; 
        }

        /// <summary>
        /// 반품마감
        /// </summary>
        [HttpPost(Name = "CBP006")]
        public IActionResult GetItem([FromBody] CBP006 jCBP006)
        {
            //_logger.LogWarning(jCBP006.ToString());

            // 객체를 JSON 문자열로 변환
            string jsonString = JsonSerializer.Serialize(jCBP006);

            _logger.LogWarning(jsonString);

            List<cResult> cResult = new List<cResult>();

            string connectionString = _configuration.GetConnectionString("DefaultConnection");

            //SAP DI Connect
            Company MACRO_company = _sapDIAPI.Get_MACRO_Company();
            Company SJ_company = _sapDIAPI.Get_SJ_Company();
            Documents oORDN = null;
            Documents oORRR = null;
            StockTransfer oOWTR = null;
            StockTransfer oOWTQ = null;
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
                if (jCBP006.APIKEY != "emdc")
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
                foreach (var jCBP006H in jCBP006.ReqList)
                {
                    try
                    {
                        ReIfKey = jCBP006H.IfKey;
                        ReProcBundleNo = jCBP006H.ProcBundleNo;

                        if (jCBP006.ReqList[i].ReturnTypeCd == "RT01") //RT01 일반반품 RT03 매장반품
                        {
                            if (jCBP006.BizSeq == 1)
                            {
                                oORDN = (Documents)MACRO_company.GetBusinessObject(BoObjectTypes.oReturns);
                                oORRR = (Documents)MACRO_company.GetBusinessObject(BoObjectTypes.oReturnRequest);
                            }
                            else
                            {
                                oORDN = (Documents)SJ_company.GetBusinessObject(BoObjectTypes.oReturns);
                                oORRR = (Documents)SJ_company.GetBusinessObject(BoObjectTypes.oReturnRequest);
                            }

                            //헤더
                            string query = "SELECT CardCode FROM " + sDB.SAPDB(jCBP006.BizSeq.ToString()) + "..ORRR WHERE DocEntry = '" + jCBP006.ReqList[i].ErpReqNo + "'";
                            _logger.LogWarning(query);

                            //쿼리 실행
                            command = new SqlCommand(query, connection);
                            reader = command.ExecuteReader();
                            reader.Read();

                            //본문
                            foreach (var jCBP006L in jCBP006.ReqList[i].ProdList)
                            {
                                if ((jCBP006L.ErpLineNo) != chk)
                                {
                                    if (j != 0)
                                    {
                                        oORDN.Lines.Add();
                                        QTYSUM = 0;
                                    }
                                }

                                //헤더
                                oORDN.CardCode = reader.GetString(0); //거래처코드
                                oORDN.DocDate = DateTime.ParseExact(jCBP006H.ProcYmd, "yyyyMMdd", null); //전기일
                                oORDN.DocDueDate = DateTime.ParseExact(jCBP006H.ProcYmd, "yyyyMMdd", null); //만기일
                                oORDN.TaxDate = DateTime.ParseExact(jCBP006H.ProcYmd, "yyyyMMdd", null); //증빙일
                                oORDN.BPL_IDAssignedToInvoice = 1; //사업장
                                oORDN.DocObjectCode = BoObjectTypes.oReturns;//반품
                                oORDN.DocType = BoDocumentTypes.dDocument_Items;//품목(품목/서비스)
                                //oORDN.Comments = ""; //비고
                                oORDN.UserFields.Fields.Item("U_WMSDOCNUM").Value = jCBP006.ReqList[i].WmsReqNo;

                                if (isNewLine == false)
                                {
                                    oORDN.Lines.BaseType = 234000031; //원천문서 타입
                                    oORDN.Lines.BaseEntry = int.Parse(jCBP006.ReqList[i].ErpReqNo); //원천문서
                                    oORDN.Lines.BaseLine = (jCBP006L.ErpLineNo); //원천라인
                                }

                                //oORDN.Lines.LineNum = jCBP006L.IfIdx;
                                oORDN.Lines.ItemCode = jCBP006L.IfProdId; //품목코드
                                oORDN.Lines.WarehouseCode = jCBP006L.ToWh; //241211 추가
                                QTYSUM = QTYSUM + jCBP006L.ExQty;
                                oORDN.Lines.InventoryQuantity = QTYSUM; //수량 //250610 수정
                                oORDN.Lines.UoMEntry = 1; //수량(EA : UOM)

                                chk = (jCBP006L.ErpLineNo);

                                //for (int i = 0; i < oORDN.Lines.Count; i++)

                                //배치
                                oORDN.Lines.BatchNumbers.ItemCode = jCBP006L.IfProdId;
                                oORDN.Lines.BatchNumbers.BatchNumber = jCBP006L.ErpBatchNo; //배치번호 jCBP006L.oITEMCODE + '@' + jCBP006L.oEXPDATE;
                                oORDN.Lines.BatchNumbers.Quantity = jCBP006L.ExQty; //수량(EA)
                                oORDN.Lines.BatchNumbers.ExpiryDate = DateTime.ParseExact(jCBP006L.ExpYmd, "yyyyMMdd", null); //유통기한
                                oORDN.Lines.BatchNumbers.Add();

                                //if (oDocDate != "") //처음행은 제외 
                                //{
                                //    if (oDocDate != jCBP006H.ProcYmd)
                                //    {
                                //        DIresult = oORDN.Add();

                                //        //오브젝트 초기화
                                //        if (oORDN != null)
                                //        {
                                //            Marshal.ReleaseComObject(oORDN);
                                //            oORDN = null;
                                //        }
                                //    }
                                //}

                                //oDocDate = jCBP006H.ProcYmd;
                                j++;
                            }

                            //마지막행 문서 추가
                            DIresult = oORDN.Add();

                            if (DIresult == 0) //241213 추가
                            {
                                //반품요청 문서 닫기
                                oORRR.GetByKey(int.Parse(jCBP006.ReqList[i].ErpReqNo));
                                oORRR.Close();
                            }

                            //오브젝트 초기화
                            if (oORRR != null)
                            {
                                Marshal.ReleaseComObject(oORRR);
                                oORRR = null;
                            }
                            if (oORDN != null)
                            {
                                Marshal.ReleaseComObject(oORDN);
                                oORDN = null;
                            }

                            j = 0;
                            QTYSUM = 0;
                            chk = 0;

                            reader.Close();

                            //DI 문서 오류 처리
                            if (DIresult != 0)
                            {
                                if (jCBP006.BizSeq == 1)
                                {
                                    ResultList.Add(new ResultListItem
                                    {
                                        IfKey = jCBP006.ReqList[i].IfKey,
                                        ProcBundleNo = jCBP006.ReqList[i].ProcBundleNo,
                                        Result = "E",
                                        Message = $"DI Error: ${MACRO_company.GetLastErrorCode()} - ${MACRO_company.GetLastErrorDescription()}"
                                    });
                                    //throw new Exception($"DI Error: ${MACRO_company.GetLastErrorCode()} - ${MACRO_company.GetLastErrorDescription()}");
                                }
                                else
                                {
                                    ResultList.Add(new ResultListItem
                                    {
                                        IfKey = jCBP006.ReqList[i].IfKey,
                                        ProcBundleNo = jCBP006.ReqList[i].ProcBundleNo,
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
                                    IfKey = jCBP006.ReqList[i].IfKey,
                                    ProcBundleNo = jCBP006.ReqList[i].ProcBundleNo,
                                    Result = "S",
                                    Message = "처리 완료"
                                });
                            }
                            i++;
                        }
                        else //재고이전
                        {
                            if (jCBP006.BizSeq == 1)
                            {
                                oOWTR = (StockTransfer)MACRO_company.GetBusinessObject(BoObjectTypes.oStockTransfer);
                                oOWTQ = (StockTransfer)MACRO_company.GetBusinessObject(BoObjectTypes.oInventoryTransferRequest);
                            }
                            else
                            {
                                oOWTR = (StockTransfer)SJ_company.GetBusinessObject(BoObjectTypes.oStockTransfer);
                                oOWTQ = (StockTransfer)SJ_company.GetBusinessObject(BoObjectTypes.oInventoryTransferRequest);
                            }

                            //본문
                            foreach (var jCBP006L in jCBP006.ReqList[i].ProdList)
                            {
                                if ((jCBP006L.ErpLineNo) != chk)
                                {
                                    if (j != 0)
                                    {
                                        oOWTR.Lines.Add();
                                        QTYSUM = 0;
                                    }
                                }

                                //헤더
                                oOWTR.DocDate = DateTime.ParseExact(jCBP006H.ProcYmd, "yyyyMMdd", null);
                                oOWTR.TaxDate = DateTime.ParseExact(jCBP006H.ProcYmd, "yyyyMMdd", null);
                                //oOWTR.Comments = "";
                                oOWTR.UserFields.Fields.Item("U_WMSDOCNUM").Value = jCBP006.ReqList[i].WmsReqNo;

                                //NEWLine 체크 
                                string query = " SELECT COUNT(*) FROM " + sDB.SAPDB(jCBP006.BizSeq.ToString()) + "..WTQ1 WHERE DocEntry = '" + jCBP006.ReqList[i].ErpReqNo + "' AND LineNum = '" + jCBP006L.ErpLineNo + "' AND ItemCode = '" + jCBP006L.IfProdId + "' ";
                                _logger.LogWarning(query);

                                //쿼리 실행
                                command = new SqlCommand(query, connection);
                                reader = command.ExecuteReader();
                                reader.Read();

                                if (reader.GetInt32(0) == 0) { isNewLine = true; } else { isNewLine = false; };

                                //라인
                                if (isNewLine == false)
                                {
                                    oOWTR.Lines.BaseType = InvBaseDocTypeEnum.InventoryTransferRequest; //원천문서 타입
                                    oOWTR.Lines.BaseEntry = int.Parse(jCBP006.ReqList[i].ErpReqNo); //원천문서
                                    oOWTR.Lines.BaseLine = (jCBP006L.ErpLineNo); //원천라인
                                }

                                //oOWTR.Lines.LineNum = int.Parse(jCBP006L.IfIdx);
                                oOWTR.Lines.ItemCode = jCBP006L.IfProdId; //품목코드
                                //oOWTR.Lines.WarehouseCode = jCBP006L.ToWh; //241211 추가
                                QTYSUM = QTYSUM + jCBP006L.ExQty;
                                oOWTR.Lines.Quantity = QTYSUM; //수량
                                oOWTR.Lines.UoMEntry = 1; //수량(EA : UOM)

                                //배치
                                oOWTR.Lines.BatchNumbers.BatchNumber = jCBP006L.ErpBatchNo; //jCBP006L.oITEMCODE + '@' + jCBP006L.oEXPDATE;
                                oOWTR.Lines.BatchNumbers.Quantity = jCBP006L.ExQty;
                                oOWTR.Lines.BatchNumbers.ExpiryDate = DateTime.ParseExact(jCBP006L.ExpYmd, "yyyyMMdd", null);
                                oOWTR.Lines.BatchNumbers.Add();

                                chk = (jCBP006L.ErpLineNo);
                                j++;

                                reader.Close();
                            }

                            //마지막행 문서 추가
                            DIresult = oOWTR.Add();

                            if (DIresult == 0) //241213 추가
                            {
                                //재고이전요청 문서 닫기
                                oOWTQ.GetByKey(int.Parse(jCBP006.ReqList[i].ErpReqNo));
                                oOWTQ.Close();
                            }

                            j = 0;
                            QTYSUM = 0;
                            chk = 0;

                            //오브젝트 초기화
                            if (oOWTR != null)
                            {
                                Marshal.ReleaseComObject(oOWTR);
                                oOWTR = null;
                            }
                            if (oOWTQ != null)
                            {
                                Marshal.ReleaseComObject(oOWTQ);
                                oOWTQ = null;
                            }

                            //DI 문서 오류 처리
                            if (DIresult != 0)
                            {
                                if (jCBP006.BizSeq == 1)
                                {
                                    ResultList.Add(new ResultListItem
                                    {
                                        IfKey = jCBP006.ReqList[i].IfKey,
                                        ProcBundleNo = jCBP006.ReqList[i].ProcBundleNo,
                                        Result = "E",
                                        Message = $"DI Error: ${MACRO_company.GetLastErrorCode()} - ${MACRO_company.GetLastErrorDescription()}"
                                    });
                                    //throw new Exception($"DI Error: ${MACRO_company.GetLastErrorCode()} - ${MACRO_company.GetLastErrorDescription()}");
                                }
                                else
                                {
                                    ResultList.Add(new ResultListItem
                                    {
                                        IfKey = jCBP006.ReqList[i].IfKey,
                                        ProcBundleNo = jCBP006.ReqList[i].ProcBundleNo,
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
                                    IfKey = jCBP006.ReqList[i].IfKey,
                                    ProcBundleNo = jCBP006.ReqList[i].ProcBundleNo,
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

                if (oORDN != null)
                {
                    Marshal.ReleaseComObject(oORDN);
                    oORDN = null;
                }
                if (oORRR != null)
                {
                    Marshal.ReleaseComObject(oORRR);
                    oORRR = null;
                }
                if (oOWTR != null)
                {
                    Marshal.ReleaseComObject(oOWTR);
                    oOWTR = null;
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