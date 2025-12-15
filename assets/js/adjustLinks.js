// assets/js/adjustLinks.js

document.addEventListener('DOMContentLoaded', function() {
  // 埋め込まれたリンクを取得
  const embedLinks = document.querySelectorAll('.notion-embed-link');
  
  // リンクにスタイルを適用
  embedLinks.forEach(link => {
    link.style.color = 'black';               // リンクの色を変更
    link.style.textDecoration = 'underline';  // リンクに下線を追加
  });
});
