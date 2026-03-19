namespace MACRO_WMS.Models
{
    //입고처리취소

    public class CBP003_ProdListItem
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

    public class CBP003_ReqListItem
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
        public List<CBP003_ProdListItem> ProdList { get; set; }

        public CBP003_ReqListItem()
        {
            ProdList = new List<CBP003_ProdListItem>();
        }
    }

    public class CBP003
    {
        public string APIKEY { get; set; }
        public int BizSeq { get; set; }
        public List<CBP003_ReqListItem> ReqList { get; set; }

        public CBP003()
        {
            ReqList = new List<CBP003_ReqListItem>();
        }
    }
}