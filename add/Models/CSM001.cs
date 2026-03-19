namespace MACRO_WMS.Models
{
    //재고이동처리

    public class CSM001_ProdListItem
    {
        public string IfIdx { get; set; }
        public int ErpLineNo { get; set; }
        public string FrWh { get; set; }
        public string FrLoc { get; set; }
        public string ToWh { get; set; }
        public string ToLoc { get; set; }
        public string IfProdId { get; set; }
        public int ProcQty { get; set; }
        public string ExpYmd { get; set; }
        public string LotNo { get; set; }
        public string ErpBatchNo { get; set; }
    }

    public class CSM001_ReqListItem
    {
        public string IfKey { get; set; }
        public string WmsReqNo { get; set; }
        public string ProcYmd { get; set; }
        public string ProcHms { get; set; }
        public string ProcUserId { get; set; }
        public string ProcBundleNo { get; set; }
        public List<CSM001_ProdListItem> ProdList { get; set; }

        public CSM001_ReqListItem()
        {
            ProdList = new List<CSM001_ProdListItem>();
        }
    }

    public class CSM001
    {
        public string APIKEY { get; set; }
        public int BizSeq { get; set; }
        public List<CSM001_ReqListItem> ReqList { get; set; }

        public CSM001()
        {
            ReqList = new List<CSM001_ReqListItem>();
        }
    }
}