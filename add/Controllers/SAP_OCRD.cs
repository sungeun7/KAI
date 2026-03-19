using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Data.SqlClient;
using MACRO_WMS.Models;

namespace MACRO_WMS.Controllers
{
    [ApiController]
    [Route("[controller]")]

    public class OCRD_SELECTController : ControllerBase
    {
        public class ApplicationDbContext : DbContext
        {
            public ApplicationDbContext(DbContextOptions<ApplicationDbContext> options) : base(options) { }

        }
        private readonly IConfiguration _configuration;

        private readonly ILogger<OCRD_SELECTController> _logger;

        public OCRD_SELECTController(ILogger<OCRD_SELECTController> logger, IConfiguration configuration)
        {
            _logger = logger;
            _configuration = configuration;
        }

        [HttpPost(Name = "OCRD_SELECT")]
        public IActionResult GetItem(string Key)
        {
            List<OCRD_SELECT> OCRD = new List<OCRD_SELECT>();

            string connectionString = _configuration.GetConnectionString("DefaultConnection");

            using (SqlConnection connection = new SqlConnection(connectionString))
            {
                //DB 연결
                connection.Open();
                
                //API KEY 체크(최소한의 보안)
                if (Key.ToString() != "WMS2812!@"){
                    return StatusCode(500, $"API KEY Error");
                }

                //SQL 쿼리문 작성부분
                string query = "SELECT TOP 10 CardCode, CardName, GroupCode FROM OCRD";
                SqlCommand command = new SqlCommand(query, connection);

                //Object화 작업
                using (SqlDataReader reader = command.ExecuteReader())
                {
                    while (reader.Read())
                    {
                        OCRD_SELECT product = new OCRD_SELECT
                        {
                            CardCode = reader.GetString(0),                            
                            CardName = reader.GetString(1),
                            GroupCode = reader.GetInt16(2)
                        };
                        OCRD.Add(product);
                    }
                }
                //결과값 전달
                var result = OCRD.Select(product => new OCRD_SELECT
                {
                    CardCode = product.CardCode,
                    CardName = product.CardName,
                    GroupCode = product.GroupCode
                })
                .ToArray();

                //DB연결 종료
                connection.Close();

                return Ok(result);
            }
        }
    }
}

