namespace MACRO_WMS.Models
{
    //출하처리취소

    public class CVA003_ProdListItem
    {
        public string IfIdx { get; set; }
        public int ErpLineNo { get; set; }
        public string IfProdId { get; set; }
        public int ExQty { get; set; }
        public string LotNo { get; set; }
        public string ErpBatchNo { get; set; }
    }

    public class CVA003_ReqListItem
    {
        public string IfKey { get; set; }
        public string OutbizTypeCd { get; set; }
        public string ProcBundleNo { get; set; }
        public int CenterSeq { get; set; }
        public string WmsReqNo { get; set; }
        public string ErpReqTypCd { get; set; }
        public string ErpReqNo { get; set; }
        public string ErpPickingNo { get; set; }
        public string EtcOutbizTypeCd { get; set; }
        public string ProcYmd { get; set; }
        public string ProcHms { get; set; }
        public string ProcUserId { get; set; }
        public List<CVA003_ProdListItem> ProdList { get; set; }

        public CVA003_ReqListItem()
        {
            ProdList = new List<CVA003_ProdListItem>();
        }
    }

    public class CVA003
    {
        public string APIKEY { get; set; }
        public int BizSeq { get; set; }
        public List<CVA003_ReqListItem> ReqList { get; set; }

        public CVA003()
        {
            ReqList = new List<CVA003_ReqListItem>();
        }
    }
}