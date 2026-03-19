namespace MACRO_WMS.Models
{
    //반품마감취소

    public class CBP007_ReqListItem
    {
        public string IfKey { get; set; }
        public string InwhTypeCd { get; set; }
        public int CenterSeq { get; set; }
        public string WmsReqNo { get; set; }
        public string ErpReqNo { get; set; }
        public string ProcYmd { get; set; }
        public string ProcHms { get; set; }
        public string ProcUserId { get; set; }
        public string ProcBundleNo { get; set; }
    }

    public class CBP007
    {
        public string APIKEY { get; set; }
        public int BizSeq { get; set; }
        public List<CBP007_ReqListItem> ReqList { get; set; }

        public CBP007()
        {
            ReqList = new List<CBP007_ReqListItem>();
        }
    }
}