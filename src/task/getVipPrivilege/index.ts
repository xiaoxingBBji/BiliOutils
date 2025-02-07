import { receiveVipMy, receiveVipPrivilege } from './vip.request';
import { TaskModule } from '@/config';
import { apiDelay, logger } from '@/utils';

/**
 * 获取当前领取状态
 */
async function getPrivilegeStatus() {
  try {
    const { data, code, message } = await receiveVipMy();
    if (code !== 0) {
      logger.info(`获取领取状态失败：${code} ${message}`);
      return;
    }
    const { list } = data;
    const stateList = list.filter(item => item.state === 0 && [1, 3, 5].includes(item.type));
    if (stateList.length === 0) {
      return;
    }
    return stateList;
    // 查找未领取的权益
  } catch (error) {
    logger.error(`获取领取状态出现异常：${error.message}`);
  }
}

function getPrivilegeName(type: number): string {
  if (type > 5 || type < 1) return `未知权益 ${type}`;
  return ['B 币券', '会员购优惠券', '漫画福利券', '会员购包邮券', '漫画商城优惠券'][type - 1];
}

async function getOnePrivilege(type: number): Promise<boolean> {
  try {
    const name = getPrivilegeName(type);
    const { code, message } = await receiveVipPrivilege(type);

    switch (code) {
      case 0:
        logger.info(`领取${name}成功！`);
        return true;
      case 73319:
        logger.error(`${name}领取失败，需要手机验证（可能异地登陆），跳过`);
        return true;
      case 69802:
        logger.warn(`${name}领取失败，${message}`);
        return true;
      default:
        logger.info(`领取${name}失败：${code} ${message}`);
        return false;
    }
  } catch (error) {
    logger.error(`领取权益出现异常：`, error);
  }
  return false;
}

async function getPrivilege(type: number) {
  let errCount = 0,
    suc = false;

  while (!suc) {
    suc = await getOnePrivilege(type);
    if (errCount > 2) {
      break;
    }
    errCount++;
  }

  return suc;
}

export default async function getVipPrivilege() {
  try {
    logger.info('----【领取大会员权益】----');
    if (TaskModule.vipStatus === 0 || TaskModule.vipType < 2) {
      logger.info('您还不是年度大会员，无法领取权益');
      return;
    }

    const privilegeList = await getPrivilegeStatus();

    if (!privilegeList || privilegeList.length === 0) {
      logger.info('暂无可领取权益（除保留）');
      return;
    }

    for (let index = 0; index < privilegeList.length; index++) {
      await apiDelay(100);
      const privilege = privilegeList[index];
      await getPrivilege(privilege.type);
    }
  } catch (error) {
    logger.error(`领取大会员权益出现异常：`, error);
  }
}
