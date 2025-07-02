FROM node:18

# ✅ חובה – מתקין את פייתון וה־pip
RUN apt-get update && apt-get install -y python3 python3-pip

# ✔️ תיקיית העבודה
WORKDIR /app

# ⬇ התקנת תלויות Node
COPY package*.json ./
RUN npm install

# ⬇ העתקת שאר הקבצים
COPY . .

# ✅ (לא חובה אבל מאוד עוזר לבדיקה)
RUN python3 --version

# 🟢 הרצת הקוד
CMD ["node", "src/app.js"]
