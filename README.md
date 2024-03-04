# BusComming-BE


## 개발환경
```
- 개발 언어: python
- 개발 환경: python3, vbenv(가상환경 사용)
- 사용 모듈: json, requests, xml.etree.ElementTree as ET, time
           ( json, requests는 모듈 다운로드 받아 추가한 것,
             그 외 python 기본 내장 )

```

## 방법
new_StationList.json file의 stop_no를 api 파라미터로 받아 통신 결과의 nxtStn 값을 찾아 json 파일로 반환

디테일한 내용은는 [여기](https://github.com/isakatty/busAPI/blob/main/README.md)에 정리하였음.

## 변경 예정
1. 현재는 new_StatonList를 1000개씩 수동으로 넣어 통신을 진행중
    - stationList(정류장 정보 원본 json) 범위로 적용하는 방법을 적용할 예정
2. 결과물 : *{ "stop_no": "20682", "nxtStn": "사당시장" }*
    - stationList에 stop_no에 맞춰서 nxtStn 값을 바로 추가해줄 수 있게 변경 예정

    사유: 현재 데이터 변환 과정이 번거롭고 비효율적임.
    ``` 
    [변환과정]
    
    (nxtStn 추출 결과) json -> excel 
    (정류장 정보 원본)json -> excel
    -----------------------------
    -> **excel 병합**
    -> json 변환
    ```
