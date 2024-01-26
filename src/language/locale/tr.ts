// Türkçe
export default {
  "The link does not have a 'mediaPath' parameter to play": "Linkte, oynatmak için bir 'mediaPath' girdisi bulunmamakta",
  "Paste timestamped link of current video": "Mevcut videonun zaman damgalı linkini yapıştır",
  "VLC Player must be open to use this command": "Bu komutu kullanabilmek için VLC Player'ın açık olması gerekmektedir",
  "No video information available": "Mevcut video bilgisine ulaşılamadı",
  //
  "Select a file to open with VLC Player": "VLC Player ile açmak için bir dosya seçin",
  "Seek forward": "İleri sar",
  "Seek backward": "Geri sar",
  "Long seek forward": "İleri uzun sar",
  "Long seek backward": "Geri uzun sar",
  "Toggle play/pause": "Oynat/duraklat",
  // snapshot
  "Take and paste snapshot from video": "Videodan anlık görüntü/snapshot yakala ve yapıştır",
  "You must restart VLC for the snapshots to be saved in the folder you set.": "Snapshotların yeni belirlediğiniz klasöre kaydedilmesi için VLC'yi yeniden başlatmalısınız.",
  "No video is currently playing": "Şu anda oynatılan bir video yok",
  "Snapshot not found, if you made a change to the snapshot folder name, try restarting VLC.":
    "Snapshot bulunamadı, eğer snapshot klasörü adında bir değişiklik yaptıysanız VLC'yi yeniden başlatmayı deneyiniz.",

  /* settings */
  "VLC Path": "VLC Yolu",
  "Select 'vlc.exe' from the folder where VLC Player is installed": "VLC Player'ın kurulu olduğu klasörden vlc.exe'yi seçiniz",
  "Select vlc.exe": "vlc.exe'yi seç",
  Port: "Port",
  "Enter a port number between 1 and 65535 for the server that will be opened to control VLC Player":
    "VLC Player'ı kontrol etmeye yarayacak server için 1 ile 65535 arasında bir port numarası giriniz",
  //
  "Always show VLC Player on top": "VLC Player'ı her zaman üstte göster",
  "Pause video while pasting timestamp": "Zaman damgası yapıştırırken videoyu duraklat",
  "Pause video while pasting snapshot": "Snapshot yapıştırırken videoyu duraklat",
  //
  "Seeking Amounts": "İleri/Geri Sarma Miktarları",
  "Normal Seek Amount (in seconds)": "Normal İleri/Geri Sarma Miktarı (saniye cinsinden)",
  "Set the seek amount for 'Seek forward/backward' commands": "İleri/Geri Sar komutları için atmala miktarını seçiniz",
  "Long Seek Amount (in seconds)": "Uzun İleri/Geri Sarma Miktarı (saniye cinsinden)",
  "Set the seek amount for 'Long seek forward/backward' commands": "Uzun İleri/Geri Sar komutları için atmala miktarını seçiniz",
  //
  "Snapshot Settings": "Snapshot Ayarları",
  "Snapshot folder": "Snapshot Klasörü",
  "Enter the folder name where snapshots will be saved in the vault": "Snapshotların kasada kaydedileceği klasör adını giriniz",
  "Select a valid file name": `Geçerli bir dosya adı seçiniz ( isim \\ / < > " * : | ? karakterlerini barındırmamalı )`,
  "Snapshot Format": "Snapshot Formatı",
  "Select the image format in which the snapshots will be saved": "Snapshotların kaydedileceği görsel formatını seçiniz",
  //
  Extra: "Ekstra",
  "Copy VLC Web Interface link": "VLC Web Interface linkini kopyala",
  "Copy command line code": "Komut satırı kodunu kopyala",
  "Copy arguments for starting VLC (for Syncplay)": "VLC'yi başlatma argümanlarını kopyala (Syncplay için)",
  "Note: If the `--snapshot-path` option contains spaces, the snapshot command will not work (this only happens for Syncplay arguments)":
    "Not: Eğer `--snapshot-path` seçeneği boşluk içeriyorsa snapshot komutu çalışmayacaktır (bu sadece Syncplay argümanları için geçerlidir)",
  "syncplay argument instructions":
    "Snapshot klasör yolu boşluk barındırdığı için Syncplay ile VLC'yi açtığınızda hata alacaksınız. Bunu düzeltmek için argümanları yapıştırıp **`Yapılandırmayı depolayın ve Syncplay'i çalıştırın`** butonuna tıklayarak bir kere başlatıp programı kapatın. Argümanlar Syncplay'in kurulu olduğu **`syncplay.ini`** dosyasına kaydedilmiş olacak, bu dosyayı açıp *`perplayerarguments`* objesinde bulunan **`#1#`** kısmını birleştirerek **`#2#`** haline getirin ve dosyayı kaydedin. Ardından Syncplay'i açıp çalıştırın.",
  "Copy to clipboard": "Panoya kopyala",
  "Copied to clipboard": "Panoya kopyalandı",

  /* vlcHelpers*/
  "Before you can use the plugin, you need to select 'vlc.exe' in the plugin settings": "Plugini kullanabilmek için önce plugin ayarlarından 'vlc.exe'yi seçmeniz gerekmekte",
  "Could not connect to VLC Player.": "VLC Player'a bağlanılamadı.",
  "The vlc.exe specified in the settings could not be run, please check again!": "Ayarlarda belirtilen vlc.exe çalıştırılamadı, lütfen tekrar kontrol ediniz!",
};
