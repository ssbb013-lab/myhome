# תמונות AI לפני ואחרי - בית נוצץ

## מצב
- ממשק עריכה: יצירה, תצוגה מקדימה, יצירה חוזרת ואישור לפני פרסום.
- Pages Function: `functions/api/task-image.js`.
- R2: דלי `myhome-task-images`, binding `TASK_IMAGES` בפרויקט Pages `myhome-family`.
- D1: טבלת `ai_image_usage` לספירת יצירות, מגבלה 30 ביום (UTC).
- מנוע: Workers AI, דגם `@cf/black-forest-labs/flux-1-schnell`.

## שלב הגדרה שנותר
בחשבון Cloudflare האישי: Workers & Pages > myhome-family > Settings > Bindings > Production > Add > Workers AI, variable name `AI`. שמרו ואז בצעו Redeploy. אין להגדיר `wrangler.toml` חדש כיוון שהפרויקט משתמש כרגע בביינדינגים ובסודות קיימים דרך Cloudflare Dashboard.

## עבודה
עריכת משימה > יצירת תמונה לכל צד > תצוגה מקדימה > אישור. רק אישור מוסיף מפתח לתוך `state.taskImages[taskId][before|after]` ב-D1. לא ליצור כמות גדולה ללא אישור עלות. מחזור יצירה חוזרת משאיר את התמונה הקודמת עד אישור החדשה.

## אבטחה
הגישה ל-API עוברת דרך middleware ההזדהות הקיים של האתר. אין להעביר מפתחות API לדפדפן. המודל יופעל רק כאשר binding `AI` קיים; לפני כן תשוב הודעת 503 והעלות אפס.

## עלות
Workers AI הוא שירות מדוד; R2 כולל מכסה חינמית. הבדיקות אינן מפעילות inference בתשלום.
