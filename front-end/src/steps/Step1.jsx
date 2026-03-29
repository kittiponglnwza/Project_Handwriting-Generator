import Group from "../components/Group"
import InfoBox from "../components/InfoBox"
import Btn from "../components/Btn"

const THAI_CONSONANTS =
  "กขฃคฅฆงจฉชซฌญฎฏฐฑฒณดตถทธนบปผฝพฟภมยรลวศษสหฬอฮ".split("")
const THAI_VOWELS = [
  "ะ",
  "ั",
  "า",
  "ำ",
  "ิ",
  "ี",
  "ึ",
  "ื",
  "ุ",
  "ู",
  "เ",
  "แ",
  "โ",
  "ใ",
  "ไ",
  "ๅ",
  "ฤ",
  "ฤๅ",
  "ฦ",
  "ฦๅ",
  "็",
]
const DIGITS = "0123456789".split("")
const ENG_UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("")
const ENG_LOWER = "abcdefghijklmnopqrstuvwxyz".split("")

const GROUPS = [
  { label: "พยัญชนะไทย", chars: THAI_CONSONANTS },
  { label: "สระไทย", chars: THAI_VOWELS },
  { label: "ตัวเลข", chars: DIGITS },
  { label: "English A-Z", chars: ENG_UPPER },
  { label: "English a-z", chars: ENG_LOWER },
]

const ALL_CHARS = GROUPS.flatMap(group => group.chars)

export default function Step1({
  selected,
  onToggle,
  onSelectAll,
  onAddChars,
  onRemoveChars,
  onClearAll,
}) {
  const selectedCount = ALL_CHARS.reduce((count, ch) => (selected.has(ch) ? count + 1 : count), 0)
  const allSelected = selectedCount === ALL_CHARS.length
  const hasAnySelected = selectedCount > 0

  return (
    <div className="fade-up">
      <InfoBox color="amber">
        Step นี้เป็นตัวเลือกเสริมสำหรับสร้าง Template ใหม่เท่านั้น ถ้าใช้ไฟล์จากภายนอก สามารถไป Step 2 ได้เลย
      </InfoBox>
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: 8,
          marginBottom: 14,
          flexWrap: "wrap",
        }}
      >
        <Btn onClick={() => onSelectAll(ALL_CHARS)} variant="sage" size="sm" disabled={allSelected}>
          เลือกทั้งหมด
        </Btn>
        <Btn onClick={onClearAll} variant="ghost" size="sm" disabled={!hasAnySelected}>
          ล้างทั้งหมด
        </Btn>
      </div>

      {GROUPS.map(group => (
        <Group
          key={group.label}
          label={group.label}
          chars={group.chars}
          selected={selected}
          onToggle={onToggle}
          onSelectGroup={onAddChars}
          onSelectOnlyGroup={onSelectAll}
          onClearGroup={onRemoveChars}
        />
      ))}
    </div>
  )
}
