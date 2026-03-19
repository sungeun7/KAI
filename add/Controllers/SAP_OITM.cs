using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Data.SqlClient;
using MACRO_WMS.Models;
using SAPbobsCOM;
using MACRO_WMS.SAP;
using System.Runtime.InteropServices;


namespace MACRO_WMS.Controllers
{
    [ApiController]
    [Route("[controller]")]

    public class OITM_SELECTController : ControllerBase
    {
        public class ApplicationDbContext : DbContext
        {
            public ApplicationDbContext(DbContextOptions<ApplicationDbContext> options) : base(options) { }

        }
        private readonly IConfiguration _configuration;

        private readonly ILogger<OITM_SELECTController> _logger;

        // SAP 관련 기본 변수
        private readonly DIAPI _sapDIAPI;
        private int connectionResult;
        private int errorCode = 0;
        private string errorMessage = "";

        public OITM_SELECTController(ILogger<OITM_SELECTController> logger, IConfiguration configuration, DIAPI sapDIAPI)
        {
            _logger = logger;
            _configuration = configuration;
            _sapDIAPI = sapDIAPI;
        }

        [HttpGet(Name = "OITM_SELECT")]
        public IActionResult GetItem()
        {
            List<OITM_SELECT> OITM = new List<OITM_SELECT>();

            //MSSQL Connect
            string connectionString = _configuration.GetConnectionString("DefaultConnection");
            //SAP DI Connect
            Company company = _sapDIAPI.Get_MACRO_Company();
            var recordset = (Recordset)company.GetBusinessObject(BoObjectTypes.BoRecordset);
            _logger.LogInformation("테스트");

            _logger.LogError("테스트");
            using (SqlConnection connection = new SqlConnection(connectionString))
            {
                try
                {   
                    connection.Open();

                    string query = "SELECT TOP 10 ItemCode, ItemName, OnHand FROM OITM";
                    SqlCommand command = new SqlCommand(query, connection);
  
                    recordset.DoQuery("SELECT TOP 1 * FROM OHEM"); // 예시 쿼리

                    string T1 = recordset.Fields.Item(0).Value.ToString();


                    using (SqlDataReader reader = command.ExecuteReader())
                    {
                        while (reader.Read())
                        {
                            OITM_SELECT product = new OITM_SELECT
                            {
                                ItemCode = reader.GetString(0),
                                ItemName = reader.GetString(1),
                                OnHand = reader.GetDecimal(2)
                            };
                            OITM.Add(product);
                        }
                    }
                    var result = OITM.Select(product => new OITM_SELECT
                    {
                        ItemCode = product.ItemCode,
                        ItemName = product.ItemName,
                        OnHand = product.OnHand
                    })
                    .ToArray();

                    connection.Close();

                    //메모리 해제(DI 및 레코드셋 사용후 필수)
                    if (recordset != null)
                    {
                        Marshal.ReleaseComObject(recordset);
                        recordset = null;
                    }

                    return Ok(result);
                }
                catch (Exception e)
                {
                    //메모리 해제(DI 및 레코드셋 사용후 필수)
                    if (recordset != null)
                    {
                        Marshal.ReleaseComObject(recordset);
                        recordset = null;
                    }
                    connection.Close();
                    return Ok("Err_Result:" + e.Message);
                }
            }
        }
    }
}

