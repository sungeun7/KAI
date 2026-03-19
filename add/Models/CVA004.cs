namespace MACRO_WMS.Models
{
    //출하처리 강제확정

    public class CVA004_ReqListItem
    {
        public string IfKey { get; set; }
        public string OutbizTypeCd { get; set; }
        public int CenterSeq { get; set; }
        public string WmsReqNo { get; set; }
        public string ErpReqTypCd { get; set; }
        public string ErpReqNo { get; set; }
        public string ErpPickingNo { get; set; }
        public string ProcYmd { get; set; }
        public string ProcHms { get; set; }
        public string ProcUserId { get; set; }
        public string ProcBundleNo { get; set; }
    }

    public class CVA004
    {
        public string APIKEY { get; set; }
        public int BizSeq { get; set; }
        public List<CVA004_ReqListItem> ReqList { get; set; }

        public CVA004()
        {
            ReqList = new List<CVA004_ReqListItem>();
        }
    }
}