import json
import requests
import xml.etree.ElementTree as ET
import xmltodict
import time


def api_call(arsId):
    
    with open('config.json', 'r') as config_file:
        config = json.load(config_file)
        api_key = config['api_key']
    
    api_url = f'http://ws.bus.go.kr/api/rest/stationinfo/getStationByUid?ServiceKey={api_key}&arsId={arsId}'
    response = requests.get(api_url)
    
    if response.status_code == 200:
        try:
            root = ET.fromstring(response.text)
            
            # 'msgHeader'와 'itemList' 존재 여부 확인
            msg_header = root.find('./msgHeader')
            if msg_header is not None and msg_header.find('./headerCd').text != '0':
                error_msg = msg_header.find('./headerMsg').text
                print(f"Error in API response for arsId {arsId}: {error_msg}")
                return "header 없음"
            
            msg_body = root.find('./msgBody')
            item_list = msg_body.findall('./itemList')
            
            if not item_list:
                print(f"Error: 'itemList' not found for arsId {arsId}")
                return "itemList없음"
            
            # itemList의 item들을 돌면서 'nxtStn' 값을 추출
            for item in item_list:
                nxt_stn_element = item.find('./nxtStn')
                # item에 nxtStn 값이 있으면 그 값 반환
                if nxt_stn_element is not None:
                    return nxt_stn_element.text
                else:
                    print(f"Warning: 'nxtStn' not found in XML for arsId {arsId}.")
                    return "item에 nxtStn없음"

        except ET.ParseError as e:
            print(f"Error: Failed to parse XML for arsId {arsId}. Error details: {e}")
            return "xml파싱에러"
    
    else:
        print(f"Error: API call failed for arsId {arsId}. Status code: {response.status_code}")
        return "api 통신에러"

def main():
    # JSON 파일에서 arsId 값 읽기
    with open('new_stationList.json', 'r', encoding='utf-8') as file:
        data = json.load(file)
    
    # nxtStn 값을 저장할 리스트 초기화
    nxtStn_list = []

    # 각 arsId에 대해 API 호출 및 nxtStn 값 저장
    for stop_data in data['DATA']:
        arsId = stop_data['stop_no']  # stop_no를 그대로 arsId로 사용
        nxtStn = api_call(arsId)
        nxtStn_list.append({'stop_no': arsId, 'nxtStn': nxtStn})

        print(f"Processing arsId: {arsId}, nxtStn: {nxtStn}")

        # 1초간 휴식
        # time.sleep(1)

    # 결과를 JSON 파일에 저장
    with open('after09120.json', 'w', encoding='utf-8') as output_file:
        json.dump(nxtStn_list, output_file, ensure_ascii=False, indent=2)

if __name__ == "__main__":
    main()