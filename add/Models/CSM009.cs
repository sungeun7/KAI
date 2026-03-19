namespace MACRO_WMS.Models
{
    //예외출고 강제확정

    public class CSM009_ReqListItem
    {
        public string IfKey { get; set; }
        public string WmsReqNo { get; set; }
        public string ErpReqNo { get; set; }
        public string ProcYmd { get; set; }
        public string ProcHms { get; set; }
        public string ProcUserId { get; set; }
        public string ProcBundleNo { get; set; }
    }

    public class CSM009
    {
        public string APIKEY { get; set; }
        public int BizSeq { get; set; }
        public List<CSM009_ReqListItem> ReqList { get; set; }

        public CSM009()
        {
            ReqList = new List<CSM009_ReqListItem>();
        }
    }
}