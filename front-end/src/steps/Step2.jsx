import { useRef, useState } from "react"
import InfoBox from "../components/InfoBox"
import Tag from "../components/Tag"
import Btn from "../components/Btn"
import C from "../styles/colors"

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024

function formatFileSize(bytes) {
  if (!bytes && bytes !== 0) return "-"
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function formatDate(timestamp) {
  if (!timestamp) return "-"
  return new Date(timestamp).toLocaleString("th-TH")
}

function validatePdf(file) {
  if (!file) return "ไม่พบไฟล์ที่อัปโหลด"

  const name = file.name?.toLowerCase() || ""
  const isPdfByExt = name.endsWith(".pdf")
  const isPdfByMime = file.type === "application/pdf"

  if (!isPdfByExt && !isPdfByMime) {
    return "รองรับเฉพาะไฟล์ PDF (.pdf) เท่านั้น"
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return "ไฟล์มีขนาดเกิน 10 MB กรุณาลดขนาดก่อนอัปโหลด"
  }

  return ""
}

function Row({ label, val }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        padding: "11px 0",
        borderBottom: `1px solid ${C.border}`,
      }}
    >
      <span style={{ flex: 1, fontSize: 12, color: C.inkMd }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 500, color: C.ink, marginRight: 12 }}>{val}</span>
      <div
        style={{
          width: 20,
          height: 20,
          borderRadius: "50%",
          background: C.sage,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#fff",
          fontSize: 10,
          fontWeight: 700,
        }}
      >
        ✓
      </div>
    </div>
  )
}

export default function Step2({ uploaded, pdfFile, onUpload, onClear }) {
  const [loading, setLoading] = useState(false)
  const [drag, setDrag] = useState(false)
  const [error, setError] = useState("")
  const fileInputRef = useRef(null)

  const openFilePicker = () => {
    fileInputRef.current?.click()
  }

  const processFile = file => {
    const validationError = validatePdf(file)
    if (validationError) {
      setError(validationError)
      return
    }

    setError("")
    setLoading(true)

    window.setTimeout(() => {
      onUpload(file)
      setLoading(false)
    }, 700)
  }

  const handleDrop = e => {
    e.preventDefault()
    setDrag(false)
    const file = e.dataTransfer?.files?.[0]
    if (file) processFile(file)
  }

  const handleInputChange = e => {
    const file = e.target.files?.[0]
    if (file) processFile(file)
    e.target.value = ""
  }

  if (loading) {
    return (
      <div
        className="fade-up"
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "60px 0",
          gap: 16,
        }}
      >
        <div className="spinner" />
        <p style={{ fontSize: 13, color: C.inkMd }}>กำลังตรวจสอบไฟล์ PDF...</p>
        <p style={{ fontSize: 11, color: C.inkLt }}>Validation: file type / size</p>
      </div>
    )
  }

  const hasUpload = uploaded && pdfFile

  if (!hasUpload) {
    return (
      <div className="fade-up">
        <InfoBox>รองรับไฟล์ PDF เท่านั้น สามารถลากวางไฟล์หรือกดเพื่อเลือกไฟล์ได้ทันที</InfoBox>
        {error && <InfoBox color="amber">{error}</InfoBox>}

        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,.pdf"
          onChange={handleInputChange}
          style={{ display: "none" }}
        />

        <div
          onClick={openFilePicker}
          onDragOver={e => {
            e.preventDefault()
            setDrag(true)
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={handleDrop}
          style={{
            border: `2px dashed ${drag ? C.ink : C.borderMd}`,
            borderRadius: 16,
            padding: "52px 32px",
            textAlign: "center",
            cursor: "pointer",
            background: drag ? C.bgAccent : C.bgCard,
            transition: "all 0.2s ease",
          }}
        >
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: "50%",
              background: C.bgMuted,
              border: `1px solid ${C.border}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 16px",
              color: C.inkMd,
              fontSize: 20,
            }}
          >
            ↑
          </div>
          <p style={{ fontSize: 14, fontWeight: 500, color: C.ink, marginBottom: 6 }}>
            วางไฟล์ PDF ที่นี่ หรือคลิกเพื่อเลือกไฟล์
          </p>
          <p style={{ fontSize: 12, color: C.inkLt }}>รองรับสูงสุด 10 MB</p>
        </div>
      </div>
    )
  }

  return (
    <div className="fade-up">
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf,.pdf"
        onChange={handleInputChange}
        style={{ display: "none" }}
      />

      {error && <InfoBox color="amber">{error}</InfoBox>}

      <div
        style={{
          background: C.bgCard,
          border: `1px solid ${C.border}`,
          borderRadius: 14,
          padding: "14px 18px",
          display: "flex",
          alignItems: "center",
          gap: 14,
          marginBottom: 20,
        }}
      >
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 10,
            background: C.bgMuted,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 20,
          }}
        >
          📄
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: C.ink,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
            title={pdfFile.name}
          >
            {pdfFile.name}
          </p>
          <p style={{ fontSize: 11, color: C.inkLt, marginTop: 2 }}>PDF • {formatFileSize(pdfFile.size)}</p>
        </div>
        <Tag color="sage">อัปโหลดแล้ว</Tag>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginBottom: 12 }}>
        <Btn onClick={openFilePicker} variant="ghost" size="sm">
          เปลี่ยนไฟล์
        </Btn>
        <Btn onClick={onClear} variant="ghost" size="sm">
          ลบไฟล์
        </Btn>
      </div>

      <div
        style={{
          background: C.bgCard,
          border: `1px solid ${C.border}`,
          borderRadius: 14,
          padding: "16px 18px",
        }}
      >
        <p
          style={{
            fontSize: 11,
            fontWeight: 500,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: C.inkLt,
            marginBottom: 4,
          }}
        >
          File Validation
        </p>
        <Row label="File type" val="PDF" />
        <Row label="MIME" val={pdfFile.type || "application/pdf"} />
        <Row label="File size" val={formatFileSize(pdfFile.size)} />
        <div style={{ display: "flex", alignItems: "center", padding: "11px 0" }}>
          <span style={{ flex: 1, fontSize: 12, color: C.inkMd }}>Last modified</span>
          <span style={{ fontSize: 12, fontWeight: 500, color: C.ink, marginRight: 12 }}>
            {formatDate(pdfFile.lastModified)}
          </span>
          <div
            style={{
              width: 20,
              height: 20,
              borderRadius: "50%",
              background: C.sage,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              fontSize: 10,
            }}
          >
            ✓
          </div>
        </div>
      </div>
    </div>
  )
}
