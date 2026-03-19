namespace MACRO_WMS.Models
{
    //예외출고처리

    public class CSM003_ProdListItem
    {
        public string IfIdx { get; set; }
        public int ErpLineNo { get; set; }
        public string IfProdId { get; set; }
        public string FrWh { get; set; }
        public int ExQty { get; set; }
        public string LotNo { get; set; }
        public string ExpYmd { get; set; }
        public string ErpBatchNo { get; set; }
    }

    public class CSM003_ReqListItem
    {
        public string IfKey { get; set; }
        public string EtcTypeCd { get; set; }
        public string ProcBundleNo { get; set; }
        public string WmsReqNo { get; set; }
        public string ErpReqNo { get; set; }
        public string ProcYmd { get; set; }
        public string ProcHms { get; set; }
        public string ProcUserId { get; set; }
        public string Note { get; set; }
        public List<CSM003_ProdListItem> ProdList { get; set; }

        public CSM003_ReqListItem()
        {
            ProdList = new List<CSM003_ProdListItem>();
        }
    }

    public class CSM003
    {
        public string APIKEY { get; set; }
        public int BizSeq { get; set; }
        public List<CSM003_ReqListItem> ReqList { get; set; }

        public CSM003()
        {
            ReqList = new List<CSM003_ReqListItem>();
        }
    }
}