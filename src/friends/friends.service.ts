import { Injectable } from '@nestjs/common';
import delXss from '../common/utils/xss';
import { CreateLinks } from './friends.interface';
import axios from 'axios'

@Injectable()
export class FriendsService {
    
    create(data: CreateLinks){
        // create data to database (todo)
        data.name = delXss(data.name)
        data.website = delXss(data.website)
        if (data.desc != null) {
            data.desc = delXss(data.desc)    
        }
        if (data.image != null) {
            data.image = delXss(data.image)
        }
        if (data.check != null) {
            data.check = 0
        }
        return data
        // return 1
    }
    async check(){
        let links: any
        let status
        const $api = axios.create()
        // $api
        let v = axios.get('https://blog.iucky.cn')
        v.then(
            function (res) {
                status = res
            }
            )
        // console.log(status)
        try {
            const res_1 = await v;
            return res_1.status;
        } catch (error) {
            if (error.response) { return error.response.status; } else { return error.message; }
        }
    }
}