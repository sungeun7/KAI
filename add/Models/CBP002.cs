namespace MACRO_WMS.Models
{
    //입고처리

    public class CBP002_ProdListItem
    {
        public string IfIdx { get; set; }
        public int ErpLineNo { get; set; }
        public string IfProdId { get; set; }
        public string Towh { get; set; }
        public int ExQty { get; set; }
        public string LotNo { get; set; }
        public string ExpYmd { get; set; }
        public string ErpBatchNo { get; set; }
    }

    public class CBP002_ReqListItem
    {
        public string IfKey { get; set; }
        public string InwhTypeCd { get; set; }
        public string ProcBundleNo { get; set; }
        public string InwhTypeDtlCd { get; set; }
        public int CenterSeq { get; set; }
        public string WmsReqNo { get; set; }
        public string ErpReqNo { get; set; }
        public string ProcYmd { get; set; }
        public string ProcHms { get; set; }
        public string ProcUserId { get; set; }
        public string Note { get; set; }
        public List<CBP002_ProdListItem> ProdList { get; set; }

        public CBP002_ReqListItem()
        {
            ProdList = new List<CBP002_ProdListItem>();
        }
    }

    public class CBP002
    {
        public string APIKEY { get; set; }
        public int BizSeq { get; set; }
        public List<CBP002_ReqListItem> ReqList { get; set; }

        public CBP002()
        {
            ReqList = new List<CBP002_ReqListItem>();
        }
    }
}