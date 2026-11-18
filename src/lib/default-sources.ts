import type { SourceConfig } from '../types';

/**
 * 内置影视采集源（苹果CMS V10 接口）。
 * 全部地址于 2026-11-18 在本机实测：搜索 / 详情 / m3u8 试播，可用性随时间与网络波动，
 * 用户可在「设置」中停用、测试、删除或添加自定义源。
 * enabled=false 的源为历史可用但当前网络不通/无播放地址，保留供随时启用。
 */
export const DEFAULT_SOURCES: SourceConfig[] = [
  { key: 'ffzy5', name: '非凡影视', url: 'http://ffzy5.tv/api.php/provide/vod', builtin: true, enabled: true },
  { key: 'ffzy', name: '非凡资源', url: 'https://api.ffzyapi.com/api.php/provide/vod', builtin: true, enabled: true },
  { key: 'lzi', name: '量子资源', url: 'https://lzizy1.com/api.php/provide/vod', builtin: true, enabled: true },
  { key: 'wujin', name: '无尽资源', url: 'https://api.wujinapi.com/api.php/provide/vod', builtin: true, enabled: true },
  { key: 'guangsu', name: '光速资源', url: 'https://api.guangsuapi.com/api.php/provide/vod', builtin: true, enabled: true },
  { key: 'hongniu', name: '红牛资源', url: 'https://www.hongniuzy2.com/api.php/provide/vod', builtin: true, enabled: true },
  { key: 'hongniu3', name: '红牛线路2', url: 'https://www.hongniuzy3.com/api.php/provide/vod', builtin: true, enabled: true },
  { key: 'huya', name: '虎牙资源', url: 'https://www.huyaapi.com/api.php/provide/vod', builtin: true, enabled: true },
  { key: 'jyzy', name: '金鹰资源', url: 'http://jyzyapi.com/api.php/provide/vod', builtin: true, enabled: true },
  { key: 'jinying', name: '金鹰点播', url: 'https://jinyingzy.com/api.php/provide/vod', builtin: true, enabled: true },
  { key: 'zy360', name: '360资源', url: 'https://360zy.com/api.php/provide/vod', builtin: true, enabled: true },
  { key: 'zy360b', name: '360线路2', url: 'https://360zy5.com/api.php/provide/vod', builtin: true, enabled: true },
  { key: 'uku', name: 'U酷资源', url: 'https://api.ukuapi88.com/api.php/provide/vod', builtin: true, enabled: true },
  { key: 'modu', name: '魔都资源', url: 'https://caiji.moduapi.cc/api.php/provide/vod', builtin: true, enabled: true },
  { key: 'jisu', name: '极速资源', url: 'https://jszyapi.com/api.php/provide/vod', builtin: true, enabled: true },
  { key: 'aidan', name: '艾旦影视', url: 'http://lovedan.net/api.php/provide/vod', builtin: true, enabled: true },
  { key: 'taopian', name: '淘片资源', url: 'https://taopianapi.com/cjapi/mc/vod/json.html', builtin: true, enabled: true },
  { key: 'zy360zz', name: '360线路3', url: 'https://360zyzz.com/api.php/provide/vod', builtin: true, enabled: true },
  { key: 'iqiyi', name: '爱奇艺资源', url: 'https://iqiyizyapi.com/api.php/provide/vod', builtin: true, enabled: true },
  { key: 'qlys', name: '麒麟影音', url: 'https://www.qlys.cc/api.php/provide/vod', builtin: true, enabled: true },
  { key: 'yzy', name: '优质资源', url: 'https://api.yyzy-tv.vip/inc/apijson.php', builtin: true, enabled: true },
  { key: 'bfx', name: '暴风线路2', url: 'http://bf.xoxowin86cisyap.com/api.php/provide/vod', builtin: true, enabled: true },
  { key: 'zuid', name: '最大资源', url: 'https://api.zuidapi.com/api.php/provide/vod', builtin: true, enabled: true },
  { key: 'mdzy', name: '魔都动漫', url: 'https://www.mdzyapi.com/api.php/provide/vod', builtin: true, enabled: true },
  { key: 'huya2', name: '虎牙资源2', url: 'https://huyazy.net/api.php/provide/vod', builtin: true, enabled: true },
  { key: 'bdzy', name: '百度云资源', url: 'https://api.apibdzy.com/api.php/provide/vod', builtin: true, enabled: false },
  { key: 'juliang', name: '巨量资源', url: 'https://api.juliang.live/api/provide/vod', builtin: true, enabled: false },
  { key: 'bfzy', name: '暴风资源', url: 'https://bfzyapi.com/api.php/provide/vod', builtin: true, enabled: false },
  { key: 'dytt', name: '电影天堂', url: 'https://caiji.dyttzyapi.com/api.php/provide/vod', builtin: true, enabled: false },
];
