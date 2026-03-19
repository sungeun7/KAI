namespace MACRO_WMS.Models
{
    //입고마감

    public class CBP004_ReqListItem
    {
        public string IfKey { get; set; }
        public string InwhTypeCd { get; set; }
        public string WmsReqNo { get; set; }
        public string ErpReqNo { get; set; }
        public string ProcYmd { get; set; }
        public string ProcHms { get; set; }
        public string ProcUserId { get; set; }
        public string ProcBundleNo { get; set; }
    }
 
    public class CBP004
    {
        public string APIKEY { get; set; }
        public int BizSeq { get; set; }
        public List<CBP004_ReqListItem> ReqList { get; set; }

        public CBP004()
        {
            ReqList = new List<CBP004_ReqListItem>();
        }
    }
} 