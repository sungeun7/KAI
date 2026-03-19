namespace MACRO_WMS.Models
{
    //반품예정취소

    public class CBP005_ReqListItem
    {
        public string IfKey { get; set; }
        public string ReturnTypeCd { get; set; }
        public string ErpReqNo { get; set; }
        public string ProcBundleNo { get; set; }
    }

    public class CBP005
    {
        public string APIKEY { get; set; }
        public int BizSeq { get; set; }
        public List<CBP005_ReqListItem> ReqList { get; set; }

        public CBP005()
        {
            ReqList = new List<CBP005_ReqListItem>();
        }
    }
}