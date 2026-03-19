namespace MACRO_WMS.Models
{
    //입고예정취소

    public class CBP001_ReqListItem
    {
        public string IfKey { get; set; }
        public string InwhTypeCd { get; set; }
        public string ErpReqNo { get; set; }
        public string ProcBundleNo { get; set; }
    }
 
    public class CBP001
    {
        public string APIKEY { get; set; }
        public int BizSeq { get; set; }
        public List<CBP001_ReqListItem> ReqList { get; set; }

        public CBP001()
        {
            ReqList = new List<CBP001_ReqListItem>();
        }
    }
}  