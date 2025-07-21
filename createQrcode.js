// generateQR.js
const QRCode = require("qrcode");
const generatePayload = require("promptpay-qr");
const _ = require("lodash");
require("dotenv").config();

const generateQR = (req, res) => {
  try {
    const amount = parseFloat(_.get(req, ["body", "amount"]));
    if (isNaN(amount)) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    const phone_number = req.body.phone_number;
    const payload = generatePayload(phone_number, { amount });

    const option = {
      color: {
        dark: "#000",
        light: "#fff",
      },
    };

    QRCode.toDataURL(payload, option, (err, url) => {
      if (err) {
        return res.status(400).json({
          respCode: 400,
          respMessage: "QR generation failed",
          error: err,
        });
      }

      return res.status(200).json({
        respCode: 200,
        respMessage: "QR generated successfully",
        result: url,
      });
    });
  } catch (error) {
    console.log(error);
  }
};

module.exports = generateQR;
