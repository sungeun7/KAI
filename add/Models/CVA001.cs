namespace MACRO_WMS.Models
{
    //출하예정취소

    public class CVA001_ReqListItem
    {
        public string IfKey { get; set; }
        public string OutbizTypeCd { get; set; }
        public int CenterSeq { get; set; }
        public string ErpReqTypCd { get; set; }
        public string ErpReqNo { get; set; }
        public string ErpPickingNo { get; set; }
        public string ProcBundleNo { get; set; }
    }

    public class CVA001
    {
        public string APIKEY { get; set; }
        public int BizSeq { get; set; }
        public List<CVA001_ReqListItem> ReqList { get; set; }

        public CVA001()
        {
            ReqList = new List<CVA001_ReqListItem>();
        }
    }
}