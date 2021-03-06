var express = require('express');
var router = express.Router();
var middleware = require('../middleware');
var cache = require('../helper/cache');
var gmailSend = require('./gmailSend/gmailSend')
var redis = cache.redis;
var courseCacheKey = cache.courseCacheKey;
var db = require('../model/db');


/** Legacy:
 * /addcourse/:id
 * /delcourse/:id
 * /inputaddcourse/:courseid
 */


// 11/18
// render -> send 
// delete some redundancy edge


/* index */
router.get('/', function(req, res) {
    db.Query(`select * from course_new order by comment_num DESC`, function(courses) {
        for (var i in courses) {
            courses[i]['選課序號'] = courses[i]['選課序號'].replace(courses[i]['系號'], '');
            var new_name = courses[i]['系所名稱'].replace(/[a-zA-Z]/g, ""); // 把系所的英文名稱拿掉（但是要避免全英文的系所）
            if (new_name != "") {
                courses[i]['系所名稱'] = new_name;
            }
        }
        res.send({
            'courses': courses,
        });
    });



});


/* 傳出歷屆所有課程 the courses all previous */
router.get('/allCoursePrev', function(req, res) {
    var columns = ['id', '課程名稱', '老師', 'semester', '系號'];
    db.GetColumn('course_all', columns, { 'column': 'id', 'order': 'DESC' }, function(courses) {
        res.json(courses)
            // console.log(JSON.stringify(courses))
    });
});

router.get('/allDpmt', function(req, res) {
    db.Query('select distinct course_new.系號 as DepPrefix, course_new.系所名稱 as DepName from course_new', function(result) {
        for (item in result) {
            var new_name = result[item].DepName.replace(/[a-zA-Z]/g, "");
            if (new_name != "") {
                result[item].DepName = new_name;
            }
        }
        data = JSON.stringify(result)
        res.json(result)
    })
})

router.get('/CourseByKeywords', function(req, res) {
    console.log('\n' + 'GET /course/CourseByKeywords');
    console.log(req.query);

    var columns = ['id', '課程名稱', '系號', '課程碼', '分班碼', '系所名稱', '老師', '時間', 'comment_num'];
    if (req.query.hasOwnProperty("queryw")) {
        // clean the query to avoid sql injection
        var cleanQuery = req.query.queryw.replace(/\'|\#|\/\*/g, "");
        // if someone want to query alternately by "space"
        var QueryArray = cleanQuery.split(" ");

        db.FindbyColumnFuzzy('course_new', columns, QueryArray, function(custom_courses) {
            res.json(custom_courses);
        });
    } else if (req.query.hasOwnProperty("course_id")) {
        db.FindbyColumn('course_new', columns, { "id": req.query.course_id }, function(custom_courses) {
            res.json(custom_courses);
        });
    }
});

router.get('/getReportData', function(req, res) {
    db.GetColumn('report_post', ['id', 'user_id', 'post_id', 'reason', 'onRead', 'reviewer', 'pass', 'response'], { 'column': 'id', 'order': 'DESC' }, function(result) {
        res.send(JSON.stringify(result))
    })
})

router.get('/getReportComment/:id', function(req, res) {
    var id = req.params.id;
    db.FindbyID('post', id, function(result) {
        res.json(result)
    })
})

router.post('/sendReport', function(req, res) {
    let pass = req.body.pass
    let postid = req.body.postid
    let response = req.body.response
    let reviewer = req.body.reviewer
    db.FindbyColumn('report_post', ['onRead'], { 'post_id': postid }, function(result) {
        if (result[0]['onRead'] == 0) { // the report isn't read
            db.Update('report_post', { 'onRead': 1, 'reviewer': reviewer, 'response': response }, { 'post_id': postid }, function() {})
                // Q: If I remove the cb function , it would cause error 'callback isn't a function', WHY?
            if (pass) {
                db.Update('report_post', { 'pass': 1 }, { 'post_id': postid }, function() {})
                gmailSend.sendMail('nckuhub@gmail.com', 'TO 檢舉人： 你的檢舉通過囉')
                gmailSend.sendMail('nckuhub@gmail.com', 'TO 被檢舉人： 有人檢舉你的心得，且通過我們審核了，你的心得將會GG喔')
                    // sendTextMessage(config.bot.test, 'ok！這則心得被通過檢舉, 心得已下架！正在發信通知被檢舉人');
                db.Query(`SELECT * FROM post WHERE id=${postid}`, function(result) {
                    uid = result[0].user_id;
                    data = JSON.stringify(result[0])
                    if (uid != 0) {
                        // .srediset(cache.userCourseKey(uid, postid), data,function(){
                        //     db.DeleteByColumn('post', {'id':postid}, function(){} )
                        // })
                    }
                })
            } else {
                db.Update('report_post', { 'pass': 0 }, { 'post_id': postid }, function() {})
                gmailSend.sendMail('nckuhub@gmail.com', 'TO 檢舉人： 你的檢舉並沒有通過')
            }
        } else {
            console.log('it has been read.')
        }
        res.send('success')
    })
})

router.get('/:id', function(req, res) {
    var id = req.params.id;
    console.log('\n' + 'GET /course/' + id);
    if (id.match(/\D/g)) {
        res.redirect('/');
    } else {
        /**
        [backend HW]
         *  1. 檢查是否有這個 :id
         *  2. 接著要是這個課程被搜尋了，那麼應該要在 count 上面 +1 表示搜尋次數
         *  3. 接著依據這個 :id 去 course_new 找出該課程的資訊
         *  4. 將 (3) 的這些資訊再去 post 裡面找出他的對應心得
         *      - Hint: 如果只用課名去 post 找，可能會找到不同老師但是都開相同的課，所以應該要用 1. 課名 2. 老師名 去找
         *  5. 找完 post 之後還需要找 course_rate，並且依照原本的 response 格式做資料整理
         *  6. 最後將這些都送回去前端～ 
         *      - Hint: res.json(data)   
         */

        res.send({
            "got": "0",
            "cold": "0",
            "sweet": "0",
            "rate_count": 0,
            'courseInfo': '',
            'comment': '',
            'rates': []
        });
    }
});

router.get('/Info/:courseID', function(req, res) {
    var id = req.params.courseID;
    console.log('\n' + 'GET /course/' + id);
    if (id.match(/\D/g)) { // if ID isn't the digital.
        res.redirect('/');
    } else {
        let col = ['id', '系號', '選課序號', '課程名稱', '老師', '時間', '學分', '選必修', '系所名稱'];
        db.FindbyColumn('course_new', col, { 'id': id }, function(info, err) {
            if (info.length == 0) {
                res.send('No data')
            } else {
                info[0]['選課序號'] = info[0]['選課序號'].replace(info[0]['系號'], '');
                res.json(info[0]);
            }
        })
    }
});

// function check_Login(req, res, all_courses, custom_courses) {
//     if (req.user) {
//         var userid = parseInt(req.user.id);
//         var colmuns = ['course_id'];
//         /* 有登入 抓取用戶的選課清單 */
//         db.FindbyColumn('cart', ['course_id'], { 'user_id': userid }, function (carts) {
//             res.json({
//                 'courses': all_courses,
//                 'custom_courses': custom_courses,
//                 'user': req.user,
//                 'carts': carts
//             });
//         });
//     } else {
//         res.json({
//             'courses': all_courses,
//             'custom_courses': custom_courses,
//             'user': req.user,
//             'carts': null //沒登入 選課清單為null
//         });
//     }
// }

module.exports = router;