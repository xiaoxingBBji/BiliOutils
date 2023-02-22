import {
  fetchWebUpStreamAddr,
  getLiveInfo,
  getNewRoomSwitch,
  operationOnBroadcastCode,
  startLive,
  stopLive,
  updateRoomInfo,
} from './blink.request';
import { logger, random } from '@/utils';
import { eventSwitch, hasCmd } from '@/utils/node';
import { dirname, resolve } from 'node:path';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { VIDEO_EXT } from './constant';
import { TaskConfig, TaskModule } from '@/config';
import { request } from '@/utils/request';

/**
 * 获取链接
 */
async function getLink() {
  try {
    const { code, data, message } = await fetchWebUpStreamAddr();
    if (code !== 0) {
      logger.warn(`获取链接失败：${code} ${message}`);
      return;
    }
    return data;
  } catch (error) {
    logger.error(`获取链接异常：`, error);
  }
}

async function clickStartLive() {
  try {
    const { code, message } = await startLive(TaskModule.roomid);
    if (code !== 0) {
      // 4 没有权限
      logger.warn(`开播失败：${code} ${message}`);
      return;
    }
    logger.info(`开播成功`);
    return operationOnBroadcastCode();
  } catch (error) {
    logger.error(`开播异常：`, error);
  }
}

async function clickStopLive() {
  try {
    const { code, message } = await stopLive(TaskModule.roomid);
    if (code !== 0) {
      logger.warn(`下播失败：${code} ${message}`);
    }
    logger.info(`下播成功`);
  } catch (error) {
    logger.error(`下播异常：`, error);
  }
}

async function startLiveByRtmp(addr: string, stopRef: Ref<boolean>) {
  const { pushToStream } = await import('@/utils/ffmpeg');
  // 根据 files 轮流推流
  const sf = () => random(true) - 0.5;
  const files = await getConfigVideoPaths();
  if (!files.length) return -1;
  return await pushToStream(files.sort(sf).sort(sf), addr, stopRef);
}

async function getConfigVideoPaths() {
  const videoPaths = resolve(dirname(process.env.__BT_CONFIG_PATH__), 'video');
  if (!existsSync(videoPaths) || !statSync(videoPaths).isDirectory()) return [];
  return readdirSync(videoPaths)
    .filter(f => VIDEO_EXT.some(e => f.endsWith(e)))
    .map(f => resolve(videoPaths, f));
}

/**
 * 初始化
 */
function init(timeout: NodeJS.Timeout) {
  return eventSwitch('SIGINT', () =>
    clickStopLive().finally(() => {
      clearTimeout(timeout);
      process.exit(0);
    }),
  );
}

export async function linkService(
  callback?: (stopRef: Ref<boolean>, timeout: NodeJS.Timeout) => any,
) {
  await getRoomid();
  if (!TaskModule.roomid) return;
  const stopRef = { value: false };
  const timeout = setTimeout(() => (stopRef.value = true), 70 * 60 * 1000);
  const sigintSwitch = init(timeout);

  callback?.(stopRef, timeout);

  try {
    if (!(await hasCmd('ffmpeg'))) {
      logger.error('未安装 ffmpeg');
      return;
    }
    // 获取推流地址
    const {
      addr: { addr, code },
    } = (await getLink()) || { addr: {} };

    if (!addr || !code) return;
    await liveConfig();
    if (!(await clickStartLive())) return;

    sigintSwitch.on();
    await startLiveByRtmp(addr + code, stopRef);
    await clickStopLive();
  } catch (error) {
    logger.exception('直播推流', error);
    await clickStopLive();
  }
  sigintSwitch.off();
}

async function liveConfig() {
  const { areaId, title, parentId } = TaskConfig.blink;
  if (title) {
    await request(updateRoomInfo, { name: '更新直播间标题' }, 1, title);
  }
  if (areaId && parentId) {
    await request(getNewRoomSwitch, { name: '设置直播分区' }, parentId, areaId);
  }
}

/**
 * 获取直播间 id
 */
async function requestRoomid() {
  try {
    const { code, message, data } = await getLiveInfo();
    if (code !== 0) {
      logger.fatal(`获取直播间 id`, code, message);
      return;
    }
    return data.room_id;
  } catch (error) {
    logger.exception('获取直播间 id', error);
  }
}

async function getRoomid() {
  const roomid = await requestRoomid();
  if (!roomid) {
    logger.error(`没有配置 blink.roomid 且获取直播间 id 失败`);
    return;
  }
  TaskModule.roomid = roomid;
  return roomid;
}
