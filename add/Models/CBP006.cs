namespace MACRO_WMS.Models
{
    //반품마감

    public class CBP006_ProdListItem
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

    public class CBP006_ReqListItem
    {
        public string IfKey { get; set; }
        public string ReturnTypeCd { get; set; }
        public int CenterSeq { get; set; }
        public string WmsReqNo { get; set; }
        public string ErpReqNo { get; set; }
        public string ProcYmd { get; set; }
        public string ProcHms { get; set; }
        public string ProcUserId { get; set; }
        public string ProcBundleNo { get; set; }
        public List<CBP006_ProdListItem> ProdList { get; set; }

        public CBP006_ReqListItem()
        {
            ProdList = new List<CBP006_ProdListItem>();
        }
    }

    public class CBP006
    {
        public string APIKEY { get; set; }
        public int BizSeq { get; set; }
        public List<CBP006_ReqListItem> ReqList { get; set; }

        public CBP006()
        {
            ReqList = new List<CBP006_ReqListItem>();
        }
    }
}