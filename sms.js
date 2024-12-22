require("dotenv/config");
const nodemailer = require("nodemailer");

// Email configuration
const transporter = nodemailer.createTransport({
  service: "gmail", // Replace with your email provider
  auth: {
    user: process.env.EMAIL_ADDRESS, // Your email address
    pass: process.env.EMAIL_PASSWORD, // App password
  },
});

/**
 * Function to send SMS via email
 * @param {string} phoneNumber - The recipient's 10-digit phone number
 * @param {string} carrierGateway - The SMS gateway domain (e.g., "txt.att.net")
 * @param {string} message - The message content
 */
const sendSMSViaEmail = async (phoneNumber, carrierGateway, message) => {
  if (!phoneNumber || !carrierGateway) {
    console.error("❌ Missing phone number or carrier gateway.");
    return;
  }

  // Validate phone number format (US-based, 10 digits)
  const phoneRegex = /^\d{10}$/;
  if (!phoneRegex.test(phoneNumber)) {
    console.error("❌ Invalid phone number format.");
    return;
  }

  // Truncate message if longer than 160 characters
  const truncatedMessage =
    message.length > 160 ? message.substring(0, 157) + "..." : message;

  const toAddress = `${phoneNumber}@${carrierGateway}`;
  const mailOptions = {
    from: process.env.EMAIL_ADDRESS,
    to: toAddress,
    subject: 'Kong Chat',
    text: truncatedMessage,
    headers: {
      'Precedence': 'bulk', // Mark as bulk email
      'Message-ID': '<kongbotnoreply@gmail.com>' // Consistent message ID
    }
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`✅ SMS sent successfully to ${phoneNumber}`);
  } catch (error) {
    console.error(`❌ Failed to send SMS to ${phoneNumber}:`, error.message);
  }
};

// Export the function for use in other modules
module.exports = { sendSMSViaEmail };
