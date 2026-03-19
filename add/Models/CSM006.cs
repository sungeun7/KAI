namespace MACRO_WMS.Models
{
    //SKU변경처리(기타출고)

    public class CSM006_ProdListItem
    {
        public string IfIdx { get; set; }
        public int ErpLineNo { get; set; }
        public string IfProdId { get; set; }
        public string FrWh { get; set; }
        public string FrLoc { get; set; }
        public int ExQty { get; set; }
        public string LotNo { get; set; }
        public string ExpYmd { get; set; }
        public string ErpBatchNo { get; set; }
    }

    public class CSM006_ReqListItem
    {
        public string IfKey { get; set; }
        public string WmsReqNo { get; set; }
        public string ErpTypeCd { get; set; }
        public string ProcYmd { get; set; }
        public string ProcHms { get; set; }
        public string ProcUserId { get; set; }
        public string ProcBundleNo { get; set; }
        public List<CSM006_ProdListItem> ProdList { get; set; }

        public CSM006_ReqListItem()
        {
            ProdList = new List<CSM006_ProdListItem>();
        }
    }

    public class CSM006
    {
        public string APIKEY { get; set; }
        public int BizSeq { get; set; }
        public List<CSM006_ReqListItem> ReqList { get; set; }

        public CSM006()
        {
            ReqList = new List<CSM006_ReqListItem>();
        }
    }
}