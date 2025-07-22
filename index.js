require("dotenv").config(); // ต้องอยู่บนสุดของไฟล์

const generateQR = require("./createQrcode");

const promptpay = require("promptpay-qr");
const qrcode = require("qrcode");
const express = require("express");
const axios = require("axios");
const bodyParser = require("body-parser");
const path = require("path");

const app = express();
const PORT = 3000;

// ENV จาก .env
const GRIST_API_KEY = process.env.GRIST_API_KEY;
const GRIST_DOC_ID = process.env.GRIST_DOC_ID;
const GRIST_TABLE = process.env.GRIST_TABLE || "Table1"; // สำรองหากไม่มีตั้งค่า

// URL API
const GRIST_API_URL = `https://docs.getgrist.com/api/docs/${GRIST_DOC_ID}/tables/${GRIST_TABLE}/records`;

app.use(express.json());
app.use(bodyParser.json()); // รองรับ JSON body

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// เส้นทางหลัก: redirect ไป index.html (หน้าแสดงรายการ)
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// API: ดึงรายการทั้งหมดจาก Grist
app.get("/api/list", async (req, res) => {
  try {
    const response = await axios.get(GRIST_API_URL, {
      headers: {
        Authorization: `Bearer ${GRIST_API_KEY}`,
      },
    });

    const rows = response.data.records.map((r) => r.fields);
    res.json(rows);
  } catch (error) {
    console.error(error.response?.data || error.message);
    res.status(500).send("❌ ไม่สามารถดึงข้อมูลได้");
  }
});

const multer = require("multer");
const fs = require("fs");

// สร้างโฟลเดอร์ uploads ถ้ายังไม่มี
const uploadDir = path.join(__dirname, "public", "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, `${unique}-${file.originalname}`);
  },
});
const upload = multer({ storage });

// ✅ POST /api/upload-slip: อัปโหลดสลิปแล้วเก็บ URL ลง Grist


const GITHUB_API = "https://api.github.com";

app.post("/api/upload-slip", upload.single("slip"), async (req, res) => {
  const { id: uuid } = req.body;
  const filename = req.file.filename;
  const localPath = req.file.path;
  const slipPathInRepo = `${process.env.GITHUB_UPLOAD_DIR}/${filename}`; // e.g. public/uploads/xxx.png

  try {
    // 🔁 อ่านไฟล์แล้วแปลง base64
    const fileBuffer = fs.readFileSync(localPath);
    const base64Content = fileBuffer.toString('base64');

    // 📤 อัปโหลดขึ้น GitHub
    const uploadUrl = `${GITHUB_API}/repos/${process.env.GITHUB_REPO}/contents/${slipPathInRepo}`;
    const commitMessage = `upload slip ${filename}`;

    await axios.put(uploadUrl, {
      message: commitMessage,
      content: base64Content,
      branch: process.env.GITHUB_BRANCH,
    }, {
      headers: {
        Authorization: `token ${process.env.GITHUB_TOKEN}`,
        "User-Agent": "upload-script"
      }
    });

    // ✅ อัปเดต Grist ด้วย Raw GitHub URL
    const slip_url = `https://raw.githubusercontent.com/${process.env.GITHUB_REPO}/${process.env.GITHUB_BRANCH}/${slipPathInRepo}`;

    // ... (ส่วนเชื่อม GRIST ตามเดิม)
    const response = await axios.get(GRIST_API_URL, {
      headers: { Authorization: `Bearer ${GRIST_API_KEY}` },
    });

    const matched = response.data.records.find((r) => r.fields.uuid === uuid);
    if (!matched) return res.status(404).json({ error: "ไม่พบ uuid ที่ระบุ" });

    const gristRowId = matched.id;

    await axios.patch(GRIST_API_URL, {
      records: [
        {
          id: gristRowId,
          fields: {
            slip_url,
            slip_at: Math.floor(Date.now() / 1000),
          },
        },
      ],
    }, {
      headers: { Authorization: `Bearer ${GRIST_API_KEY}` },
    });

    res.json({ slip_url });
  } catch (err) {
    console.error("UPLOAD ERROR:", err.response?.data || err.message);
    res.status(500).json({ error: "ไม่สามารถอัปโหลดสลิปขึ้น GitHub ได้." });
  }
});

// ✅ POST /api/confirm: เปลี่ยนสถานะ is_verified เป็น true
app.post("/api/confirm", async (req, res) => {
  const { id: uuid, confirm_slip } = req.body;
    let isConfirm = confirm_slip
  
  try {

    if (!confirm_slip) {
        isConfirm = false
    }
    // 1. ดึงรายการทั้งหมดจาก Grist
    const response = await axios.get(GRIST_API_URL, {
      headers: {
        Authorization: `Bearer ${GRIST_API_KEY}`,
      },
    });

    // 2. หา row ที่มี uuid ตรงกัน
    const matched = response.data.records.find(
      (r) => r.fields.uuid === uuid
    );

    if (!matched) {
      return res.status(404).json({ error: "ไม่พบ uuid ที่ระบุ" });
    }

    const gristRowId = matched.id;

    // 3. PATCH โดยใช้ row id ที่แท้จริง
    await axios.patch(
      GRIST_API_URL,
      {
        records: [
          {
            id: gristRowId,
            fields: {
              is_verify: true,
              confirm_slip: isConfirm,
              verify_confirm_at: Math.floor(Date.now() / 1000)
            },
          },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${GRIST_API_KEY}`,
        },
      }
    );
    
    

    res.json({ success: true });
  } catch (err) {
    console.error("CONFIRM ERROR:", err.response?.data || err.message);
    res.status(500).json({ error: "ไม่สามารถยืนยันได้" });
  }
});


// ✅ GET /api/history: ดึงเฉพาะรายการที่ยืนยันแล้ว
app.get("/api/history", async (req, res) => {
  try {
    const response = await axios.get(GRIST_API_URL, {
      headers: {
        Authorization: `Bearer ${GRIST_API_KEY}`,
      },
    });

    const records = response.data.records
      .map((r) => r.fields)
      .filter((r) => r.is_verified === true);

    res.json(records);
  } catch (error) {
    console.error(error.response?.data || error.message);
    res.status(500).send("❌ ไม่สามารถดึงประวัติได้");
  }
});

app.post("/api/qrcode", generateQR);

// POST: รับข้อมูลจากฟอร์มและส่งเข้า Grist
app.post("/submit", async (req, res) => {
  const { title, creditor, payer, description, amount, phone_number } = req.body;
    console.log(phone_number)
  try {
    await axios.post(
      GRIST_API_URL,
      {
        records: [
          {
            fields: {
              title,
              creditor,
              payer,
              description,
              phone_number,
              is_verify: false,
              amount: parseFloat(amount),
            },
          },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${GRIST_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    // ⬇️ เพิ่มท้ายไฟล์ (อย่าแก้โค้ดเดิม)

    // หลังบันทึกเสร็จ ให้ redirect กลับหน้า index.html
    res.redirect("/");
  } catch (error) {
    console.error(error.response?.data || error.message);
    res.status(500).send("❌ เกิดข้อผิดพลาดในการบันทึกข้อมูล");
  }
});

// เริ่มเซิร์ฟเวอร์
app.listen(PORT, () => {
  console.log(`✅ Server running at: http://localhost:${PORT}`);
});
