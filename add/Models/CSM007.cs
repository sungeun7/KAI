namespace MACRO_WMS.Models
{
    //세트작업처리(기타입고)

    public class CSM007_ProdListItem
    {
        public string IfIdx { get; set; }
        public int ErpLineNo { get; set; }
        public string IfProdId { get; set; }
        public string ToWh { get; set; }
        public int ExQty { get; set; }
        public string LotNo { get; set; }
        public string ExpYmd { get; set; }
        public string ErpBatchNo { get; set; }
    }

    public class CSM007_ReqListItem
    {
        public string IfKey { get; set; }
        public string WmsReqNo { get; set; }
        public string ErpTypeCd { get; set; }
        public string ProcYmd { get; set; }
        public string ProcHms { get; set; }
        public string ProcUserId { get; set; }
        public string ProcBundleNo { get; set; }
        public string Note { get; set; }
        public List<CSM007_ProdListItem> ProdList { get; set; }

        public CSM007_ReqListItem()
        {
            ProdList = new List<CSM007_ProdListItem>();
        }
    }

    public class CSM007
    {
        public string APIKEY { get; set; }
        public int BizSeq { get; set; }
        public List<CSM007_ReqListItem> ReqList { get; set; }

        public CSM007()
        {
            ReqList = new List<CSM007_ReqListItem>();
        }
    }
}