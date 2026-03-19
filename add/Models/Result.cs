namespace MACRO_WMS.Models
{
    public class ResultListItem
    {
        public string IfKey { get; set; }
        public string ProcBundleNo { get; set; }
        public string Result { get; set; }
        public string Message { get; set; }
    }

    public class cResult
    {
        public string HttpResult { get; set; }
        public string HttpMessage { get; set; }
        public List<ResultListItem> ResultList { get; set; }
        
        public cResult()
        {
            ResultList = new List<ResultListItem>();
        }
    }
}