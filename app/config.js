// env for the Admin Panel
module.exports = {
  MONGODB_URI: process.env.MONGODB_URI || "mongodb://database:27017/revolt",
  ADMIN_USERNAME: process.env.ADMIN_USERNAME || "admin",
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || "changeme"
};
