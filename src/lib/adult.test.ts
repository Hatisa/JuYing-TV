import { describe, expect, it } from 'vitest';
import { filterAdult, isAdultGroup, isAdultMedia, isAdultText, isAdultType } from './adult';

describe('adult 内容甄别', () => {
  it('识别明确的成人分类', () => {
    expect(isAdultType('伦理片')).toBe(true);
    expect(isAdultType('福利视频')).toBe(true);
    expect(isAdultType('海外抖音')).toBe(true);
    expect(isAdultType('网红主播')).toBe(true);
    expect(isAdultType('海外剧')).toBe(false);
    expect(isAdultType('海外综艺')).toBe(false);
  });

  it('从片名识别成人内容但避免误伤', () => {
    expect(isAdultMedia({ name: '海外抖音合集', typeName: '剧情片' })).toBe(true);
    expect(isAdultMedia({ name: '网红主播私拍', typeName: '剧情片' })).toBe(true);
    expect(isAdultMedia({ name: '海角七号', typeName: '电影' })).toBe(false);
    expect(isAdultMedia({ name: '乡村爱情', typeName: '国产剧', remarks: '更新至30集' })).toBe(false);
    expect(isAdultMedia({ name: '复仇者联盟', typeName: '动作片' })).toBe(false);
  });

  it('备注与来源标记也参与判断', () => {
    expect(isAdultMedia({ name: '某影片', typeName: '电影', remarks: '无码' })).toBe(true);
    expect(isAdultMedia({ name: '某影片', typeName: '电影', isAdult: true })).toBe(true);
    expect(isAdultText('普通更新至12集')).toBe(false);
  });

  it('分组内混入成人内容时整组过滤', () => {
    const group = {
      items: [
        { name: '正常电影', typeName: '电影' },
        { name: '成人影片', typeName: '伦理片' },
      ],
    };
    expect(isAdultGroup(group)).toBe(true);
    expect(filterAdult(group.items, false)).toHaveLength(1);
    expect(filterAdult(group.items, true)).toHaveLength(1);
  });
});
