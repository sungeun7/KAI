namespace MACRO_WMS.Models
{
    //예외출고예정취소

    public class CSM002_ReqListItem
    {
        public string IfKey { get; set; }
        public string ErpReqNo { get; set; }
        public string ProcBundleNo { get; set; }
    }

    public class CSM002
    {
        public string APIKEY { get; set; }
        public int BizSeq { get; set; }
        public List<CSM002_ReqListItem> ReqList { get; set; }

        public CSM002()
        {
            ReqList = new List<CSM002_ReqListItem>();
        }
    }
}