export default function Header({ status }) {
  return (
    <header className="app-header">
      <h1 className="app-title">KAI</h1>
      <p className="app-subtitle">SAP 전표·문서 실제 생성 (DI/SAP 연동)</p>
      {status && (
        <p className="app-status">
          API: {status.apiConfigured ? '연결됨' : '미설정'} · 청크:{' '}
          {status.chunkCount ?? 0}
          {status.sapOdataConfigured ? ' · SAP OData: 설정됨' : ''}
          {status.diServerConfigured ? ' · DI: 연결' : ''}
        </p>
      )}
    </header>
  )
}
